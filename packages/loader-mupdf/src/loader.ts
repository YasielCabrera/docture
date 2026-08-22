/**
 * `MuPdfLoader` — read a PDF's text layer, with positions, using MuPDF compiled to WASM.
 *
 * The library is in the class name on purpose. Swapping pdf.js for MuPDF is
 * `new MuPdfLoader()`, and the conformance suite both classes pass is what makes that a
 * guarantee rather than a hope.
 *
 * This loader does NOT render pages, even though MuPDF can. Reading and rendering stay
 * separate plugins so that either half can be swapped alone — `MuPdfLoader` can feed
 * `NapiCanvasRasterizer`, and `PdfJsLoader` can feed `MuPdfRasterizer`. Compose when you
 * want both:
 *
 * ```ts
 * withRasterizer(new MuPdfLoader(), new MuPdfRasterizer({ dpi: 300 }))
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
import {
  loadMuPdf,
  openDocument,
  withMuPdfLog,
  type MuPdfDocument,
  type MuPdfStructuredText,
} from "./mupdf.js";

export interface MuPdfLoaderOptions {
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

export class MuPdfLoader implements DocumentLoader<LoaderCapabilities<true, true, false>> {
  readonly name = "mupdf";

  readonly capabilities = {
    text: true,
    geometry: true,
    images: false,
    mimeTypes: ["application/pdf"],
  } as const;

  constructor(private readonly options: MuPdfLoaderOptions = {}) {}

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();
    const mupdf = await loadMuPdf();

    return withMuPdfLog(ctx.logger, () => {
      const pdf = openDocument(mupdf, document.bytes, this.options.password);
      try {
        const pageCount = pdf.countPages();
        const limit = Math.min(pageCount, this.options.maxPages ?? pageCount);
        const pages: LoadedPage[] = [];

        for (let index = 0; index < limit; index += 1) {
          // Every MuPDF call below is a blocking WASM call, so this loop cannot yield and
          // nothing can flip the signal once it starts. What the check does catch is an
          // abort that landed during `await loadMuPdf()` above — and it keeps the loop
          // correct for whatever MuPDF makes async later.
          ctx.signal.throwIfAborted();
          pages.push(this.readPage(pdf, index));
        }

        return {
          pages,
          // Form feed between pages: a page break is not a line break, and a parser
          // looking for a page boundary should be able to find one.
          text: pages.map((p) => p.text).join("\f"),
          form: inferForm(pages.map((p) => p.text.trim().length)),
          loader: this.name,
          meta: { pageCount, pagesRead: pages.length },
        };
      } finally {
        // Frees the document's WASM allocation. Without it a long batch grows the heap
        // until the engine can no longer allocate.
        pdf.destroy();
      }
    });
  }

  private readPage(pdf: MuPdfDocument, index: number): LoadedPage {
    const page = pdf.loadPage(index);
    try {
      // MuPDF normalizes a page to a top-left origin at (0, 0) — a CropBox starting at
      // (20, 30) yields bounds of `[0, 0, w, h]` with text positioned relative to it. So
      // this package needs neither an axis flip nor an origin offset: what MuPDF reports
      // is already the convention this library standardises on.
      const [x0, y0, x1, y1] = page.getBounds();
      const stext = page.toStructuredText("preserve-whitespace");
      try {
        const lines = linesFromWords(wordsFrom(stext), {
          ...(this.options.lineTolerance === undefined
            ? {}
            : { lineTolerance: this.options.lineTolerance }),
        });

        return {
          pageNumber: index + 1,
          width: x1 - x0,
          height: y1 - y0,
          text: textFromLines(lines),
          lines,
        };
      } finally {
        stext.destroy();
      }
    } finally {
      page.destroy();
    }
  }
}

/**
 * Words, from MuPDF's structured text.
 *
 * MuPDF walks a page as characters inside its own lines, and those lines are text RUNS,
 * not visual rows: an invoice row's four cells arrive as four separate lines, so grouping
 * them back into a row is left to `linesFromWords` — the same helper every geometry
 * loader in this repo uses, which is what makes a table parser portable across them.
 * What a MuPDF line boundary does tell us is a WORD boundary, since two runs are separate
 * words even when no space was drawn between them.
 */
function wordsFrom(stext: MuPdfStructuredText): PositionedWord[] {
  const words: PositionedWord[] = [];
  let text = "";
  let box: [number, number, number, number] | undefined;

  const flush = (): void => {
    if (box !== undefined && text.trim() !== "") words.push({ text, box });
    text = "";
    box = undefined;
  };

  stext.walk({
    beginLine: flush,
    endLine: flush,
    onChar(character, _origin, _font, _size, quad) {
      if (character.trim() === "") {
        flush();
        return;
      }
      // A quad is the glyph's four corners, which need not be axis-aligned (rotated
      // text, a skewed scan). `PositionedWord` wants a box, so take the hull.
      const [ulx, uly, urx, ury, llx, lly, lrx, lry] = quad;
      const left = Math.min(ulx, urx, llx, lrx);
      const top = Math.min(uly, ury, lly, lry);
      const right = Math.max(ulx, urx, llx, lrx);
      const bottom = Math.max(uly, ury, lly, lry);

      text += character;
      box =
        box === undefined
          ? [left, top, right, bottom]
          : [
              Math.min(box[0], left),
              Math.min(box[1], top),
              Math.max(box[2], right),
              Math.max(box[3], bottom),
            ];
    },
  });

  // The last word on the page has no boundary after it.
  flush();
  return words;
}
