/**
 * `PdfJsLoader` — read a PDF's text layer, with positions, using Mozilla's PDF.js.
 *
 * The library is in the class name on purpose. Swapping to MuPDF is
 * `new MuPdfLoader()`, and the conformance suite both classes pass is what makes
 * that a guarantee rather than a hope.
 *
 * This loader does NOT render pages — that is a rasterizer's job. Compose them when
 * you need both:
 *
 * ```ts
 * withRasterizer(new PdfJsLoader(), new NapiCanvasRasterizer())
 * ```
 */

import {
  inferForm,
  linesFromWords,
  textFromLines,
  type DocumentLoader,
  type LoadContext,
  type LoadedDocument,
  type LoadedPage,
  type LoaderCapabilities,
  type PositionedWord,
  type RawDocument,
} from "@docture/core";
import { loadPdfJs, type PdfJsPage, type PdfJsTextItem } from "./pdfjs.js";

export interface PdfJsLoaderOptions {
  /** Password for an encrypted PDF. */
  readonly password?: string;
  /** Stop after this many pages. Useful for a cheap classification pass. */
  readonly maxPages?: number;
  /**
   * Vertical band tolerance for grouping text runs into lines, as a fraction of
   * median run height. Raise it for loose leading, lower it for dense tables.
   */
  readonly lineTolerance?: number;
}

/** pdf.js emits `TextMarkedContent` entries too; only items with `str` are text. */
function isTextItem(item: PdfJsTextItem): item is PdfJsTextItem & {
  str: string;
  transform: readonly number[];
} {
  return typeof item.str === "string" && Array.isArray(item.transform);
}

export class PdfJsLoader implements DocumentLoader<LoaderCapabilities<true, true, false>> {
  readonly name = "pdfjs";

  readonly capabilities = {
    text: true,
    geometry: true,
    images: false,
    mimeTypes: ["application/pdf"],
  } as const;

  constructor(private readonly options: PdfJsLoaderOptions = {}) {}

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();
    const { pdfjs, standardFontDataUrl } = await loadPdfJs();

    const task = pdfjs.getDocument({
      // pdf.js takes ownership of the buffer it is given, so hand it a copy —
      // otherwise the caller's bytes come back detached and a second loader in the
      // fallback chain receives an empty array.
      data: new Uint8Array(document.bytes),
      standardFontDataUrl,
      isEvalSupported: false,
      // Fonts installed on the host would make extraction machine-dependent.
      useSystemFonts: false,
      ...(this.options.password === undefined ? {} : { password: this.options.password }),
    });

    let pdf;
    try {
      pdf = await task.promise;
    } catch (error) {
      await task.destroy().catch(() => {});
      throw new Error(`pdfjs could not open the document: ${describe(error)}`, { cause: error });
    }

    try {
      const limit = Math.min(pdf.numPages, this.options.maxPages ?? pdf.numPages);
      const pages: LoadedPage[] = [];

      for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
        ctx.signal.throwIfAborted();
        const page = await pdf.getPage(pageNumber);
        try {
          pages.push(await this.readPage(pdfjs, page, pageNumber));
        } finally {
          page.cleanup();
        }
      }

      return {
        pages,
        // Form feed between pages: a page break is not a line break, and a parser
        // looking for a page boundary should be able to find one.
        text: pages.map((p) => p.text).join("\f"),
        form: inferForm(pages.map((p) => p.text.trim().length)),
        loader: this.name,
        meta: { pageCount: pdf.numPages, pagesRead: pages.length },
      };
    } finally {
      // Frees the worker and the parsed document. Without it a long batch leaks.
      await task.destroy().catch(() => {});
    }
  }

  private async readPage(
    pdfjs: Awaited<ReturnType<typeof loadPdfJs>>["pdfjs"],
    page: PdfJsPage,
    pageNumber: number,
  ): Promise<LoadedPage> {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const words: PositionedWord[] = [];
    for (const item of content.items) {
      if (!isTextItem(item) || item.str.trim() === "") continue;

      // `viewport.transform` maps PDF user space (bottom-left origin) into device
      // space (top-left origin), which is the convention this library standardises
      // on. Composing it with the item's own matrix is the only correct way to get
      // there — reading `transform[4]`/`[5]` raw ignores page rotation.
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const x = tx[4] ?? 0;
      const baseline = tx[5] ?? 0;
      // Scaled font size, from the matrix's vertical component.
      const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || (item.height ?? 0);
      const width = item.width ?? 0;

      words.push({
        text: item.str,
        // Baseline minus font height is the top edge, near enough for banding —
        // and exact relative ordering is all line grouping needs.
        box: [x, baseline - fontHeight, x + width, baseline],
      });
    }

    const lines = linesFromWords(words, {
      ...(this.options.lineTolerance === undefined
        ? {}
        : { lineTolerance: this.options.lineTolerance }),
    });

    return {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      text: textFromLines(lines),
      lines,
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
