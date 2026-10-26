/**
 * The pdf.js module, loaded once and lazily.
 *
 * `await import()` at FIRST USE rather than at module import: constructing a
 * `DocumentLoaderPdfJs` must be free, and a pipeline that never reads a PDF must not pay
 * pdf.js's startup cost. The architecture test asserts pdf.js is not statically
 * reachable from this package's entry point.
 *
 * Two details this file exists to encapsulate, both of which pdf.js will otherwise
 * make the caller's problem:
 *
 *  - In Node you must use the **legacy** build. The default build reaches for
 *    `DOMMatrix` at module scope and throws `ReferenceError` outside a browser.
 *  - Standard fonts (Helvetica, Times, …) need `standardFontDataUrl`, or every
 *    document logs "Ensure that the `standardFontDataUrl` API parameter is
 *    provided" and metrics fall back to guesses.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { importEngine, lazyEngine } from "../../core/engines.js";

/** The slice of pdf.js this package uses. Structural, so no pdf.js types leak out. */
export interface PdfJsModule {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<PdfJsDocument>;
    destroy(): Promise<void>;
  };
  Util: {
    transform(a: readonly number[], b: readonly number[]): number[];
  };
  OPS: Readonly<Record<string, number>>;
  ImageKind: Readonly<Record<string, number>>;
}

export interface PdfJsDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  getMetadata(): Promise<{ info: Readonly<Record<string, unknown>>; metadata?: unknown }>;
  getMarkInfo(): Promise<{ Marked: boolean } | null>;
  cleanup(): Promise<void>;
}

export interface PdfJsViewport {
  readonly width: number;
  readonly height: number;
  readonly transform: number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export interface PdfJsImageData {
  readonly width: number;
  readonly height: number;
  readonly kind?: number;
  readonly data?: Uint8Array | Uint8ClampedArray;
}

export interface PdfJsObjects {
  get(id: string, callback?: (value: PdfJsImageData | null) => void): PdfJsImageData | null | undefined;
}

export interface PdfJsPage {
  readonly objs: PdfJsObjects;
  getViewport(options: { scale: number }): PdfJsViewport;
  getTextContent(options?: { includeMarkedContent?: boolean; disableNormalization?: boolean }): Promise<{
    items: readonly (PdfJsTextItem | PdfJsMarkedContent)[];
    styles: Readonly<Record<string, { fontFamily: string; vertical?: boolean }>>;
    lang: string | null;
  }>;
  getAnnotations(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  getStructTree(): Promise<PdfJsStructTree | null>;
  getOperatorList(): Promise<{
    fnArray: readonly number[];
    argsArray: readonly (readonly unknown[])[];
  }>;
  cleanup(): boolean;
}

export interface PdfJsMarkedContent {
  readonly type: string;
  readonly id?: string;
}

export interface PdfJsStructTree {
  readonly role: string;
  readonly children: readonly (PdfJsStructTree | { readonly type: string; readonly id: string })[];
}

export interface PdfJsTextItem {
  readonly str?: string;
  readonly transform?: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly hasEOL?: boolean;
  readonly dir?: string;
  readonly fontName?: string;
}

/**
 * Resolve pdf.js's own asset directories from wherever it was installed.
 *
 * A plain filesystem path with a trailing slash — NOT a `file://` URL. Despite the
 * option being called `standardFontDataUrl`, the Node build reads these through the
 * filesystem, and Node's `fetch` cannot open `file://`; passing a URL makes every
 * document log "Unable to load font data" and fall back to guessed metrics.
 */
function resolveAssets(): { standardFontDataUrl: string } {
  const require = createRequire(import.meta.url);
  // The legacy entry point is what we import; its directory anchors the assets.
  const entry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const root = dirname(dirname(dirname(entry)));
  return { standardFontDataUrl: `${join(root, "standard_fonts")}/` };
}

export const loadPdfJs = lazyEngine(async (): Promise<{ pdfjs: PdfJsModule; standardFontDataUrl: string }> => {
  const module = (await importEngine("docture/loaders/pdfjs", ["pdfjs-dist"], () =>
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  )) as unknown as PdfJsModule;
  return { pdfjs: module, ...resolveAssets() };
});
