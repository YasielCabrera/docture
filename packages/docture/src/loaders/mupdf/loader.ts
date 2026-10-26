import { setImmediate } from "node:timers/promises";
import { requestedPageNumbers } from "../../core/pipeline/pages.js";
import {
  inferForm,
  linesFromWords,
  textFromLines,
  type DocumentLoader,
  type LoadContext,
  type LoadedDocument,
  type LoadedAsset,
  type LoadedPage,
  type ImageLayoutBlock,
  type LayoutBlock,
  type LoaderCapabilities,
  type PositionedWord,
  type RawDocument,
  type TextLine,
} from "../../core/index.js";
import {
  loadMuPdf,
  openDocument,
  withMuPdfLog,
  type MuPdfDocument,
  type MuPdfStructuredText,
} from "./mupdf.js";

export interface DocumentLoaderMuPdfOptions {
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

/**
 * Read PDF text, geometry and optional conversion layout using MuPDF.
 *
 * @remarks DocumentLoaderMuPdfOptions sets password, maxPages and text grouping. LoadRequest.pages restricts original pages read. Page processing yields between pages.
 * @throws MISSING_ENGINE when mupdf is absent; PAGE_OUT_OF_RANGE for unavailable selected pages. Other PDF decode errors retain their engine cause.
 * @example
 * ```ts
 * import { DocumentLoaderMuPdf } from "docture/loaders/mupdf";
 * const loader = new DocumentLoaderMuPdf({ maxPages: 10 });
 * ```
 */
export class DocumentLoaderMuPdf implements DocumentLoader<LoaderCapabilities<true, true, false>> {
  readonly name = "mupdf";

  readonly capabilities = {
    text: true,
    geometry: true,
    images: false,
    mimeTypes: ["application/pdf"],
  } as const;

  constructor(private readonly options: DocumentLoaderMuPdfOptions = {}) {}

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();
    const mupdf = await loadMuPdf();

    const pdf = withMuPdfLog(ctx.logger, () => openDocument(mupdf, document.bytes, this.options.password));
    try {
      const pageCount = withMuPdfLog(ctx.logger, () => pdf.countPages());
      const wanted = requestedPageNumbers(pageCount, ctx.request?.pages, this.options.maxPages);
      const pages: LoadedPage[] = [];

      for (const [position, pageNumber] of wanted.entries()) {
        if (position > 0) await setImmediate();
        ctx.signal.throwIfAborted();
        pages.push(withMuPdfLog(ctx.logger, () => this.readPage(pdf, pageNumber - 1, ctx)));
      }

      const metadata = ctx.request?.layout === true
        ? withMuPdfLog(ctx.logger, () => metadataFrom(pdf))
        : undefined;
      return {
        pages,
        // Form feed between pages: a page break is not a line break, and a parser
        // looking for a page boundary should be able to find one.
        text: pages.map((p) => p.text).join("\f"),
        form: inferForm(pages.map((p) => p.text.trim().length)),
        loader: this.name,
        ...(metadata === undefined ? {} : { metadata }),
        meta: { pageCount, pagesRead: pages.length },
      };
    } finally {
      withMuPdfLog(ctx.logger, () => pdf.destroy());
    }
  }

  private readPage(pdf: MuPdfDocument, index: number, ctx: LoadContext): LoadedPage {
    const page = pdf.loadPage(index);
    try {
      // MuPDF normalizes a page to a top-left origin at (0, 0) — a CropBox starting at
      // (20, 30) yields bounds of `[0, 0, w, h]` with text positioned relative to it. So
      // this package needs neither an axis flip nor an origin offset: what MuPDF reports
      // is already the convention this library standardises on.
      const [x0, y0, x1, y1] = page.getBounds();
      const stext = page.toStructuredText(
        ctx.request?.layout === true
          ? "preserve-whitespace,preserve-images"
          : "preserve-whitespace",
      );
      try {
        const links = ctx.request?.layout === true ? linksFrom(page) : [];
        const rich = wordsAndImagesFrom(stext, index + 1, ctx.request?.assets === true, links);
        const lines = linesFromWords(rich.words, {
          ...(this.options.lineTolerance === undefined
            ? {}
            : { lineTolerance: this.options.lineTolerance }),
        });

        const blocks: LayoutBlock[] = [
          ...lines.map((line, lineIndex) => ({
            id: `p${index + 1}-text-${lineIndex + 1}`,
            kind: "text" as const,
            ...boxFromLine(line),
            lines: [line],
          })),
          ...rich.imageBlocks,
        ];

        return {
          pageNumber: index + 1,
          width: x1 - x0,
          height: y1 - y0,
          text: textFromLines(lines),
          lines,
          ...(ctx.request?.layout === true ? { blocks } : {}),
          ...(ctx.request?.assets === true ? { assets: rich.assets } : {}),
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
interface LinkArea {
  readonly box: readonly [number, number, number, number];
  readonly href: string;
}

interface RichPageData {
  readonly words: readonly PositionedWord[];
  readonly imageBlocks: readonly ImageLayoutBlock[];
  readonly assets: readonly LoadedAsset[];
}

function wordsAndImagesFrom(
  stext: MuPdfStructuredText,
  pageNumber: number,
  includeAssets: boolean,
  links: readonly LinkArea[],
): RichPageData {
  const words: PositionedWord[] = [];
  const imageBlocks: ImageLayoutBlock[] = [];
  const assets: LoadedAsset[] = [];
  let text = "";
  let box: [number, number, number, number] | undefined;
  let style: PositionedWord["style"];
  let direction: PositionedWord["direction"];

  const flush = (): void => {
    if (box !== undefined && text.trim() !== "") {
      const href = links.find((link) => intersects(box!, link.box))?.href;
      words.push({
        text,
        box,
        ...(style === undefined ? {} : { style }),
        ...(direction === undefined ? {} : { direction }),
        ...(href === undefined ? {} : { href }),
      });
    }
    text = "";
    box = undefined;
    style = undefined;
    direction = undefined;
  };

  stext.walk({
    beginLine: flush,
    endLine: flush,
    onChar(character, _origin, font, size, quad, _color, bidi) {
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
      style ??= {
        fontFamily: font.getName(),
        fontSize: size,
        bold: font.isBold(),
        italic: font.isItalic(),
        monospace: font.isMono(),
      };
      direction ??= bidi % 2 === 0 ? "ltr" : "rtl";
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
    onImageBlock(bbox, _transform, image) {
      flush();
      const imageNumber = imageBlocks.length + 1;
      const id = `p${pageNumber}-image-${imageNumber}`;
      const [x0, y0, x1, y1] = bbox;
      imageBlocks.push({
        id,
        kind: "image",
        assetId: id,
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
      });
      if (!includeAssets) return;
      const pixmap = image.toPixmap();
      try {
        assets.push({
          id,
          pageNumber,
          name: `${id}.png`,
          mimeType: "image/png",
          bytes: new Uint8Array(pixmap.asPNG()),
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
          widthPx: pixmap.getWidth(),
          heightPx: pixmap.getHeight(),
        });
      } finally {
        pixmap.destroy();
      }
    },
  });

  // The last word on the page has no boundary after it.
  flush();
  return { words, imageBlocks, assets };
}

function boxFromLine(line: TextLine): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const spans = line.spans;
  const x = spans.length === 0 ? 0 : Math.min(...spans.map((span) => span.x));
  const right = spans.length === 0 ? 0 : Math.max(...spans.map((span) => span.x + span.width));
  return { x, y: line.y, width: right - x, height: line.height };
}

function intersects(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function linksFrom(page: ReturnType<MuPdfDocument["loadPage"]>): LinkArea[] {
  const links = page.getLinks();
  try {
    return links.map((link) => ({ box: link.getBounds(), href: link.getURI() }));
  } finally {
    for (const link of links) link.destroy();
  }
}

function metadataFrom(pdf: MuPdfDocument): LoadedDocument["metadata"] {
  const title = pdf.getMetaData("info:Title");
  const author = pdf.getMetaData("info:Author");
  const subject = pdf.getMetaData("info:Subject");
  const rawKeywords = pdf.getMetaData("info:Keywords");
  const language = pdf.asPDF()?.getLanguage() ?? undefined;
  if (
    title === undefined &&
    author === undefined &&
    subject === undefined &&
    rawKeywords === undefined &&
    language === undefined
  ) {
    return undefined;
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(subject === undefined ? {} : { subject }),
    ...(rawKeywords === undefined
      ? {}
      : { keywords: rawKeywords.split(/[,;]/u).map((keyword) => keyword.trim()).filter(Boolean) }),
    ...(language === undefined ? {} : { language }),
  };
}
