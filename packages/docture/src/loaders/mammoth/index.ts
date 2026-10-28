import { Buffer } from "node:buffer";
import { importEngine, lazyEngine } from "../../core/engines.js";
import { DoctureError, inferForm, type DocumentLoader, type LoadContext, type LoadedDocument, type RawDocument } from "../../core/index.js";
import { requestedPageNumbers } from "../../core/pipeline/pages.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const loadMammoth = lazyEngine(() => importEngine("docture/loaders/mammoth", ["mammoth"], () => import("mammoth")));

export class MammothDocumentError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "MammothDocumentError";
  override readonly code = "LOAD_FAILED" as const;
}

/**
 * Read DOCX text into one logical page using Mammoth, without generated HTML.
 *
 * @remarks Install mammoth explicitly. Node-only. Headings and table cells retain source order but lose formatting, geometry and physical pagination. Cancellation is checked before and after Mammoth work; it cannot interrupt a running parse.
 * @throws MISSING_ENGINE when mammoth is absent; LOAD_FAILED for invalid DOCX; PAGE_OUT_OF_RANGE for a page other than 1.
 * @example
 * ```ts
 * import { DocumentLoaderMammoth } from "docture/loaders/mammoth";
 * const loader = new DocumentLoaderMammoth();
 * ```
 */
export class DocumentLoaderMammoth implements DocumentLoader {
  readonly name = "mammoth";
  readonly capabilities = { text: true, geometry: false, images: false, mimeTypes: [DOCX] } as const;

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();
    requestedPageNumbers(1, ctx.request?.pages);
    const engine = await loadMammoth();
    ctx.signal.throwIfAborted();
    let result: Awaited<ReturnType<typeof engine.extractRawText>>;
    try {
      result = await engine.extractRawText({ buffer: Buffer.from(document.bytes) });
    } catch (cause) {
      ctx.signal.throwIfAborted();
      throw new MammothDocumentError("Mammoth could not read the DOCX document.", { cause });
    }
    ctx.signal.throwIfAborted();
    if (result.messages.length > 0) {
      ctx.logger.warn("Mammoth reported DOCX diagnostics", { loader: this.name, count: result.messages.length, types: result.messages.map((message) => message.type) });
    }
    return {
      pages: [{ pageNumber: 1, width: 0, height: 0, text: result.value }],
      text: result.value,
      form: inferForm([result.value.trim().length]),
      loader: this.name,
      meta: { pagination: "logical", pagesRead: 1, diagnostics: result.messages.map((message) => ({ type: message.type })) },
    };
  }
}
