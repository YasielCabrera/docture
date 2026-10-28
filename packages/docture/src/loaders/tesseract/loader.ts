import { availableParallelism } from "node:os";
import { requestedPageNumbers } from "../../core/pipeline/pages.js";
import { PageSelectionError } from "../../core/pipeline/errors.js";
import { readsAsTiff } from "../../core/pipeline/source.js";
import { tiffLayout, tiffPageTooLarge } from "../../core/domain/tiff.js";
import { pageImageRenderer } from "../../core/contracts/page-images.js";
import {
  imageSize,
  inferForm,
  linesFromWords,
  sniffMimeType,
  textFromLines,
  type DocumentLoader,
  type LoadContext,
  type LoadedDocument,
  type LoadedPage,
  type LoaderCapabilities,
  type PositionedWord,
  type RasterOptions,
  type RasterPage,
  type Rasterizer,
  type RawDocument,
  type TiffPage,
} from "../../core/index.js";
import { TesseractPool, type PageSegmentation, type Recognition } from "./tesseract.js";

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/tiff"] as const;

/** TIFF compressions the bundled leptonica decodes, each checked against a fixture. Deflate is not among them. */
const TIFF_COMPRESSIONS = new Map([
  [1, "none"],
  [3, "CCITT G3"],
  [4, "CCITT G4"],
  [5, "LZW"],
  [32773, "PackBits"],
]);

/** 300 DPI is the usual floor for OCR accuracy; below ~200 it degrades sharply. */
const DEFAULT_DPI = 300;

type PageImages = (
  pageNumber: number,
  options: RasterOptions | undefined,
  signal: AbortSignal | undefined,
  decoded: Uint8Array | undefined,
) => Promise<Uint8Array>;

interface OcrPage {
  readonly pageNumber: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scale: number;
  readonly loadBytes: () => Uint8Array;
  readonly keepDecodedPng: boolean;
}

/** A rendered page paired with what OCR made of it. */
interface RecognizedPage {
  readonly raster: OcrPage;
  readonly recognition: Recognition;
}

export interface DocumentLoaderTesseractOptions {
  /**
   * How pages become pixels. Required to read anything that is not already a PNG or
   * JPEG — a PDF, most obviously.
   */
  readonly rasterizer?: Rasterizer;
  /**
   * Traineddata languages, most-likely first: `["eng"]`, or `["eng", "deu"]` for a
   * bilingual document. Each is downloaded once (~5 MB) and cached.
   */
  readonly languages?: readonly string[];
  /** Render resolution for the OCR pass. Default 300. */
  readonly dpi?: number;
  /** Stop after this many pages. Useful for a cheap classification pass. */
  readonly maxPages?: number;
  /**
   * How Tesseract should read the page's layout. Default `"auto"` — full layout
   * analysis, the mode the tesseract CLI uses. `"sparse"` suits receipts and forms
   * where text sits in unrelated islands.
   */
  readonly pageSegmentation?: PageSegmentation;
  /**
   * Drop words Tesseract is less than this sure of, 0–1. Default 0 — every word it
   * reports is kept, and `span.confidence` lets a strategy judge for itself. Raise it
   * to filter speckle noise on a poor scan, knowing it can also drop real words.
   */
  readonly minConfidence?: number;
  /**
   * Vertical band tolerance for grouping words into lines, as a fraction of median
   * word height. Raise it for loose leading, lower it for dense tables.
   */
  readonly lineTolerance?: number;
  /**
   * Detect and correct page skew before recognizing. Costs an extra layout pass per
   * page; worth it for photographs and anything scanned by hand. Default false.
   */
  readonly autoRotate?: boolean;
  /**
   * How many pages to recognize at once. Each lane is a worker thread with its own
   * WASM engine and model. The recorded four-page, 300 DPI benchmark used about
   * 210 MiB more memory per extra worker. Default max(1, min(4, availableParallelism() - 1)).
   */
  readonly concurrency?: number;
  /**
   * Where to find `<lang>.traineddata` — a directory or a base URL. Set it to run
   * fully offline against vendored models. Default: the jsdelivr CDN.
   */
  readonly langPath?: string;
  /**
   * Where downloaded traineddata is cached. Default: `$XDG_CACHE_HOME/docture/tesseract`,
   * or `~/.cache/docture/tesseract`. Never the working directory, which is what
   * tesseract.js itself would use.
   */
  readonly cachePath?: string;
  /**
   * Raw Tesseract variables, applied after everything above — the escape hatch for
   * anything this interface does not name, e.g.
   * `{ tessedit_char_whitelist: "0123456789.," }`.
   */
  readonly parameters?: Readonly<Record<string, string>>;
}

/**
 * Recognize image or rasterized PDF text with a reusable Tesseract worker pool.
 *
 * @remarks DocumentLoaderTesseractOptions configures languages, DPI, concurrency and an optional PDF rasterizer. Default concurrency leaves one available CPU free and caps the pool at four workers. Dispose or await using releases workers.
 * @throws MISSING_ENGINE when tesseract.js is absent; PAGE_OUT_OF_RANGE for unavailable selected pages. Recognition and rendering failures reject load.
 * @example
 * ```ts
 * import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
 * const loader = new DocumentLoaderTesseract({ concurrency: 1 });
 * ```
 */
export class DocumentLoaderTesseract implements DocumentLoader<LoaderCapabilities<true, true, true>> {
  readonly name = "tesseract";

  /**
   * `text` and `geometry` because OCR reports positioned words; `images` because
   * this loader necessarily has the pixels and a vision strategy may want them —
   * see {@link LoadedPage.image}.
   *
   * `mimeTypes` is the one part that depends on how the instance was built: with no
   * rasterizer wired there is no honest way to read a PDF, so it is not advertised.
   */
  readonly capabilities: LoaderCapabilities<true, true, true>;

  /** Created on first `load()`, reused across loads, released by `dispose()`. */
  private pool: TesseractPool | undefined;

  constructor(private readonly options: DocumentLoaderTesseractOptions = {}) {
    this.capabilities = {
      text: true,
      geometry: true,
      images: true,
      mimeTypes:
        options.rasterizer === undefined
          ? IMAGE_MIME_TYPES
          : [...IMAGE_MIME_TYPES, "application/pdf"],
    };
  }

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();

    const dpi = this.options.dpi ?? DEFAULT_DPI;
    const mimeType =
      document.mimeType ?? sniffMimeType(document.bytes) ?? "application/octet-stream";

    const rendered = await this.render(document, mimeType, dpi, ctx);
    const byPage = new Map(rendered.map((raster) => [raster.pageNumber, raster]));
    const knownCount = rendered.reduce((count, raster) => Math.max(count, raster.pageNumber), 0);
    const wanted = ctx.request?.pages === undefined
      ? [...byPage.keys()].filter((number) => number <= (this.options.maxPages ?? Infinity)).sort((a, b) => a - b)
      : requestedPageNumbers(knownCount, ctx.request.pages, this.options.maxPages);
    const read = wanted.map((number) => {
      const raster = byPage.get(number);
      if (raster === undefined) throw new PageSelectionError([number], knownCount);
      return raster;
    });
    const recognized = await this.recognizeAll(read, dpi, ctx);

    // Rendering is memoized per page and per set of options, so asking twice costs
    // once — while a document nobody looks at costs nothing.
    const images = this.pageImages(document, mimeType, dpi, ctx);
    const pages = recognized.map(({ raster, recognition }) =>
      this.toPage(raster, recognition, images),
    );

    const confidence =
      recognized.length === 0
        ? 0
        : recognized.reduce((sum, r) => sum + r.recognition.confidence, 0) / recognized.length;

    return {
      pages,
      // Form feed between pages: a page break is not a line break, and a parser
      // looking for a page boundary should be able to find one.
      text: pages.map((p) => p.text).join("\f"),
      // NOT hardcoded `"digital"`: OCR on a blank or hopeless page finds nothing, and
      // reporting that honestly is what lets the pipeline fall through to a vision
      // strategy instead of handing a model an empty string.
      form: inferForm(pages.map((p) => p.text.trim().length)),
      loader: this.name,
      meta: {
        ...(ctx.request?.pages === undefined && this.options.maxPages === undefined ? { pageCount: rendered.length } : {}),
        pagesRead: pages.length,
        dpi,
        languages: this.languages(),
        // Mean word confidence across the pages read, 0–1. Worth surfacing: a low
        // number is the signal to raise `dpi`, deskew, or hand the page to a model.
        meanConfidence: Math.round(confidence * 1000) / 1000,
      },
    };
  }

  /** Terminate the workers. Idempotent; a later `load()` starts a fresh pool. */
  async dispose(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    await pool?.terminate();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  // ── Pixels in ─────────────────────────────────────────────────────────────────

  private async render(
    document: RawDocument,
    mimeType: string,
    dpi: number,
    ctx: LoadContext,
  ): Promise<readonly OcrPage[]> {
    const pointsPerPixel = 72 / dpi;
    const images = IMAGE_MIME_TYPES as readonly string[];
    if (readsAsTiff(mimeType, document.bytes, images)) {
      return tiffOcrPages(document.bytes, mimeType).map((page) => ({
        pageNumber: page.pageNumber,
        widthPx: page.widthPx,
        heightPx: page.heightPx,
        scale: pointsPerPixel,
        loadBytes: () => tiffPageBytes(document.bytes, page),
        keepDecodedPng: true,
      }));
    }
    if (images.includes(mimeType)) {
      const size = imageSize(document.bytes);
      if (size === undefined) {
        throw new Error(`tesseract: these bytes are not a readable PNG or JPEG (${mimeType}).`);
      }
      return [{ pageNumber: 1, ...size, scale: pointsPerPixel, loadBytes: () => document.bytes, keepDecodedPng: false }];
    }

    const rasterizer = this.options.rasterizer;
    if (rasterizer === undefined) {
      throw new Error(
        `tesseract: ${mimeType} has to be rendered before it can be recognized, and no ` +
          `rasterizer is wired. Pass one — new DocumentLoaderTesseract({ rasterizer: new ` +
          `NapiCanvasRasterizer() }) — or hand this loader a PNG, JPEG or TIFF.`,
      );
    }

    // PNG, always: OCR reads thresholded pixels, and JPEG artefacts around glyph
    // edges cost accuracy for a saving nobody here benefits from.
    const rendered = await rasterizer.rasterize(document, {
      dpi,
      format: "png",
      ...(ctx.request?.pages === undefined ? {} : { pages: ctx.request.pages }),
      ...(this.options.maxPages === undefined ? {} : { maxPages: this.options.maxPages }),
    }, ctx);
    if (rendered.length === 0) {
      throw new Error(`tesseract: ${rasterizer.name} rendered no pages for this document.`);
    }
    return rendered.map((raster: RasterPage) => ({
      pageNumber: raster.pageNumber,
      widthPx: raster.widthPx,
      heightPx: raster.heightPx,
      scale: raster.scale,
      loadBytes: () => raster.bytes,
      keepDecodedPng: false,
    }));
  }

  // ── Text out ──────────────────────────────────────────────────────────────────

  /**
   * OCR every page, up to `concurrency` at a time, and return them in page order.
   */
  private async recognizeAll(
    rasters: readonly OcrPage[],
    dpi: number,
    ctx: LoadContext,
  ): Promise<readonly RecognizedPage[]> {
    // One normalization for both the pool's size and the fan-out below, so a
    // fractional or zero `concurrency` cannot make them disagree.
    const concurrency = Math.max(1, Math.floor(
      this.options.concurrency ?? Math.min(4, availableParallelism() - 1),
    ));

    const pool = (this.pool ??= new TesseractPool({
      languages: this.languages(),
      concurrency,
      dpi,
      pageSegmentation: this.options.pageSegmentation ?? "auto",
      ...(this.options.langPath === undefined ? {} : { langPath: this.options.langPath }),
      ...(this.options.cachePath === undefined ? {} : { cachePath: this.options.cachePath }),
      ...(this.options.parameters === undefined ? {} : { parameters: this.options.parameters }),
    }));

    const results: (RecognizedPage | undefined)[] = new Array(rasters.length).fill(undefined);
    const autoRotate = this.options.autoRotate ?? false;
    let cursor = 0;
    let stopped = false;

    const lane = async (): Promise<void> => {
      while (!stopped) {
        const index = cursor;
        cursor += 1;
        const raster = rasters[index];
        if (raster === undefined) return;

        // Between pages is the only place this can be interrupted: Tesseract has no
        // cancellation, so a page already inside the engine runs to completion.
        ctx.signal.throwIfAborted();
        try {
          const recognition = await pool.recognize(raster.loadBytes(), { autoRotate, returnDecodedPng: raster.keepDecodedPng });
          results[index] = { raster, recognition };
        } catch (error) {
          // One unreadable page ends the load rather than burning minutes on the rest.
          stopped = true;
          throw error;
        }
      }
    };

    const lanes = Math.max(1, Math.min(concurrency, rasters.length));
    await Promise.all(Array.from({ length: lanes }, () => lane()));
    ctx.signal.throwIfAborted();

    return results.map((page, index) => {
      // Every lane fills its own slot or throws, so this is unreachable — but a
      // silently dropped page would be far worse than a loud one.
      if (page === undefined) {
        throw new Error(`tesseract: page ${index + 1} produced no recognition.`);
      }
      return page;
    });
  }

  private toPage(
    raster: OcrPage,
    recognition: Recognition,
    images: PageImages,
  ): LoadedPage {
    const floor = this.options.minConfidence ?? 0;
    const words: PositionedWord[] = recognition.words
      .filter((word) => word.confidence >= floor)
      .map((word) => ({ text: word.text, box: word.box, confidence: word.confidence }));

    /**
     * Tesseract's own block → paragraph → line grouping is deliberately discarded in
     * favour of core's `linesFromWords`, for two reasons. It is what makes an OCR'd
     * page and a text-layer page group identically, so a parser written against one
     * works on the other. And it is more useful here: on a table, Tesseract's layout
     * analysis routinely puts the right-hand column in its OWN block, which splits
     * "Widget 11 216.98" from the "2,386.78" that belongs on the same row. Banding by
     * `y` puts the row back together.
     *
     * `scale` is points-per-pixel, so this is also where pixel boxes become the PDF
     * points every other loader reports.
     */
    const lines = linesFromWords(words, {
      scale: raster.scale,
      ...(this.options.lineTolerance === undefined
        ? {}
        : { lineTolerance: this.options.lineTolerance }),
    });

    const pageNumber = raster.pageNumber;
    return {
      pageNumber,
      width: raster.widthPx * raster.scale,
      height: raster.heightPx * raster.scale,
      text: textFromLines(lines),
      lines,
      image: (options?: RasterOptions, call?: { readonly signal?: AbortSignal }) =>
        images(pageNumber, options, call?.signal, recognition.image),
    };
  }

  // ── Pixels back out ───────────────────────────────────────────────────────────

  /**
   * The page as an image, for a vision strategy that wants to look at what the OCR
   * pass read.
   *
   * The raster from the OCR pass is deliberately NOT retained: holding every page of
   * a 200-page scan in memory to serve a strategy that looks at two of them is the
   * wrong trade. It is re-rendered on demand and memoized instead.
   */
  private pageImages(document: RawDocument, mimeType: string, dpi: number, ctx: LoadContext): PageImages {
    const rasterizer = this.options.rasterizer;
    // The input WAS an image. Re-encoding it to honour `format` or `dpi` would lose
    // quality to satisfy a request the bytes already answer.
    const render =
      rasterizer === undefined || (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
        ? undefined
        : pageImageRenderer(rasterizer, document, ctx);
    return async (pageNumber, options, signal, decoded) => {
      if (decoded !== undefined || render === undefined) {
        (signal ?? ctx.signal).throwIfAborted();
        return decoded ?? document.bytes;
      }
      return render(pageNumber, { dpi, format: "png", ...options }, signal);
    };
  }

  private languages(): readonly string[] {
    const languages = this.options.languages ?? ["eng"];
    if (languages.length === 0) {
      throw new Error("tesseract: `languages` cannot be empty; pass at least one, e.g. ['eng'].");
    }
    return languages;
  }
}

function tiffOcrPages(bytes: Uint8Array, mimeType: string): readonly TiffPage[] {
  const layout = tiffLayout(bytes);
  if (layout === undefined) {
    throw new Error(`tesseract: these bytes are not a readable TIFF (${mimeType}).`);
  }
  const { pages, pixelData } = layout;
  const unsupported = pages.find((page) => !TIFF_COMPRESSIONS.has(page.compression));
  if (unsupported !== undefined) {
    const supported = [...TIFF_COMPRESSIONS].map(([code, name]) => `${name} (${code})`).join(", ");
    throw new Error(
      `tesseract: TIFF page ${unsupported.pageNumber} uses compression ${unsupported.compression}, ` +
        `which this loader does not read. Supported: ${supported}.`,
    );
  }
  for (const page of pages) {
    const tooLarge = tiffPageTooLarge(page, pixelData[page.pageNumber - 1]!);
    if (tooLarge !== undefined) throw new Error(`tesseract: ${tooLarge}`);
  }
  return pages;
}

/** Tesseract decodes only the first IFD, so later pages get a copy whose header points at theirs. */
function tiffPageBytes(bytes: Uint8Array, page: TiffPage): Uint8Array {
  if (page.pageNumber === 1) return bytes;
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint32(4, page.ifdOffset, page.littleEndian);
  return copy;
}
