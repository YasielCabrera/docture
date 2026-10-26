/**
 * The MuPDF WASM module, loaded once and lazily — plus the two things both classes in
 * this package need from it.
 *
 * `await import()` at FIRST USE rather than at module import: `mupdf` runs a top-level
 * `await` that instantiates its WASM module, so a static import would make merely
 * naming `DocumentLoaderMuPdf` cost the whole engine. Constructing either class must be free,
 * and a pipeline that never opens a document must not pay for the engine at all.
 *
 * Unlike this repo's pdf.js packages, the types here are MuPDF's own: `mupdf` ships a
 * precise `.d.ts`, so hand-rolling a structural subset would only be a worse copy of it.
 *
 * ONE ENGINE, SHARED. `mupdf` instantiates a single WASM module at import and every
 * `Document` lives in its heap. `DocumentLoaderMuPdf` and `MuPdfRasterizer` therefore share one
 * engine — which is exactly why they are one package: two packages would mean two copies
 * of a 10 MB WASM binary to read and render the same file.
 */

import { silentLogger, type Logger } from "../../core/index.js";
import { importEngine, lazyEngine } from "../../core/engines.js";

/** MuPDF's module namespace. A type-only reference, so it is erased at build time. */
export type MuPdf = typeof import("mupdf");

/**
 * The handful of MuPDF types this package names, derived rather than imported.
 *
 * `mupdf` exports its classes as values, not as types, and does not export the walker
 * interface at all — so deriving from the one entry point that IS reachable
 * (`Document.openDocument`) is how these get names without re-declaring any of them.
 */
export type MuPdfDocument = ReturnType<MuPdf["Document"]["openDocument"]>;
type MuPdfPage = ReturnType<MuPdfDocument["loadPage"]>;
export type MuPdfStructuredText = ReturnType<MuPdfPage["toStructuredText"]>;


/**
 * Where MuPDF's own diagnostics go right now.
 *
 * MuPDF reports through a global log hook, and its default lands on stderr — so a
 * malformed PDF prints "trying to repair broken xref" no matter what logger the caller
 * configured. This library's contract is that logging goes through `ctx.logger` and that
 * `silentLogger` is silent, so the hook is installed once and dispatched from here.
 */
let sink: Logger = silentLogger;

export const loadMuPdf = lazyEngine(async (): Promise<MuPdf> => {
  const module = await importEngine("docture/loaders/mupdf", ["mupdf"], () => import("mupdf"));
  module.setLog({
    // MuPDF's "error" is a diagnostic about the document, not a failed call — a
    // failed call throws. `warn` is the honest level for both.
    error: (message) => sink.warn("mupdf reported an error", { detail: message }),
    warning: (message) => sink.warn("mupdf reported a warning", { detail: message }),
  });
  return module;
});

/**
 * Run `work` with MuPDF's diagnostics routed into `logger`.
 *
 * `work` is SYNCHRONOUS on purpose. Every MuPDF call is a blocking WASM call, so all of
 * this package's document work is synchronous anyway — and taking a sync callback makes
 * it impossible for two operations to interleave between the swap and the restore, which
 * is what would otherwise attribute one document's warnings to another's logger.
 */
export function withMuPdfLog<T>(logger: Logger, work: () => T): T {
  const previous = sink;
  sink = logger;
  try {
    return work();
  } finally {
    sink = previous;
  }
}

/**
 * Open `bytes` as a PDF, authenticating if it is encrypted.
 *
 * The caller's array is NOT copied: MuPDF copies it into the WASM heap rather than
 * taking ownership of the buffer, so — unlike pdf.js — the next loader in a fallback
 * chain still receives its bytes. [`test/loader.test.ts`](../test/loader.test.ts) pins
 * that down.
 */
export function openDocument(
  mupdf: MuPdf,
  bytes: Uint8Array,
  password: string | undefined,
): MuPdfDocument {
  let document: MuPdfDocument;
  try {
    // The magic string tells MuPDF which format to expect instead of letting it guess
    // from bytes we have already sniffed. This package declares `application/pdf` and
    // nothing else, so there is exactly one right answer.
    document = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch (error) {
    throw new Error(`mupdf could not open the document: ${describe(error)}`, { cause: error });
  }

  if (!document.needsPassword()) return document;

  if (password === undefined) {
    document.destroy();
    throw new Error(
      "mupdf could not open the document: it is encrypted and no `password` was given.",
    );
  }
  // 0 means neither the user nor the owner password matched.
  if (document.authenticatePassword(password) === 0) {
    document.destroy();
    throw new Error("mupdf could not open the document: the `password` was rejected.");
  }
  return document;
}

export function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
