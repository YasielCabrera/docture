import { requestedPageNumbers } from "../../core/pipeline/pages.js";
import { PageSelectionError } from "../../core/pipeline/errors.js";
import { readsAsTiff } from "../../core/pipeline/source.js";
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
  type Rasterizer,
  type RawDocument,
  type TiffPage,
} from "../../core/index.js";
import {
  PaddleEngine,
  type ImageEngine,
  type PaddleModel,
  type PaddleModelFiles,
  type Recognition,
  type RecognitionStrategy,
} from "./paddle.js";
import { readableTiffPages, tiffPagesAsPng } from "./tiff.js";

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/tiff"] as const;

/** 300 DPI is the usual floor for OCR accuracy; below ~200 it degrades sharply. */
const DEFAULT_DPI = 300;

/**
 * ppu-paddle-ocr's own defaults, restated in one place because `meta` reports them
 * and the line-grouping band is derived from the padding — three readers of the same
 * number, which is three chances to drift.
 */
const DEFAULT_MODEL: PaddleModel = "v6Tiny";
const DEFAULT_STRATEGY: RecognitionStrategy = "perLine";
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_IMAGE_ENGINE: ImageEngine = "openCv";
const DEFAULT_PADDING_VERTICAL = 0.4;
const DEFAULT_PADDING_HORIZONTAL = 0.6;

/** core's `linesFromWords` default, for the derivation in {@link lineToleranceFor}. */
const CORE_LINE_TOLERANCE = 0.5;

/**
 * The band for grouping regions into lines, as a fraction of median region height.
 *
 * Derived from the padding rather than fixed, so the two cannot drift. core bands at
 * half the median box height, which for a text layer is half a line of text. A box
 * PaddleOCR reports is `1 + 2 × paddingVertical` times the text inside it, so leaving
 * this at 0.5 would band at 0.9 of a line — nearly twice as permissive as every other
 * loader on a document where nothing about the text changed. Dividing by the same
 * factor makes the band proportional to the text instead of to the padding.
 *
 * Exported for its test, not from the package.
 */
export function lineToleranceFor(paddingVertical: number): number {
  return CORE_LINE_TOLERANCE / (1 + 2 * Math.max(0, paddingVertical));
}

type OcrPage = {
  readonly pageNumber: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scale: number;
} & ({ readonly bytes: Uint8Array } | { readonly tiff: TiffPage });

type PageImages = (
  pageNumber: number,
  options: RasterOptions | undefined,
  signal: AbortSignal | undefined,
  decoded: Uint8Array | undefined,
) => Promise<Uint8Array>;

interface RecognizedPage {
  readonly raster: OcrPage;
  readonly image: Uint8Array;
  readonly recognition: Recognition;
}

export interface DocumentLoaderPaddleOcrOptions {
  /**
   * How pages become pixels. Required to read anything that is not already a PNG or
   * JPEG — a PDF, most obviously.
   */
  readonly rasterizer?: Rasterizer;
  /**
   * Which model bundle to run. PaddleOCR ships a recognizer per SCRIPT rather than
   * per language, so this is where a Cyrillic or Thai document is accommodated:
   * `"v5Cyrillic"`, `"v5Thai"`. Default `"v6Tiny"` — the fastest, and Latin-capable.
   *
   * Pass the three files explicitly instead to run offline, or to run a model the
   * catalogue does not list:
   *
   * ```ts
   * new DocumentLoaderPaddleOcr({
   *   model: {
   *     detection: "./models/det.onnx",
   *     recognition: "./models/rec.onnx",
   *     charactersDictionary: "./models/dict.txt",
   *   },
   * });
   * ```
   */
  readonly model?: PaddleModel | PaddleModelFiles;
  /** Render resolution for the OCR pass. Default 300. */
  readonly dpi?: number;
  /** Stop after this many pages. Useful for a cheap classification pass. */
  readonly maxPages?: number;
  /**
   * Drop regions PaddleOCR is less than this sure of, 0–1. Default 0.5, which is
   * upstream PaddleOCR's `drop_score` and this library's.
   *
   * Worth knowing that `DocumentLoaderTesseract` defaults to 0 instead. The difference is
   * not an inconsistency: a detect-then-recognize model reports a CONFIDENT reading
   * of whatever the detector handed it, so hatch patterns, logos and barcodes come
   * back as plausible text at 0.2–0.45. Lower it to see everything the detector
   * found; raise it on a noisy scan.
   */
  readonly minConfidence?: number;
  /**
   * How the recognizer batches the regions the detector found. Default `"perLine"`
   * — regions on a line are stitched into one inference, which is both faster and
   * more accurate than reading each in isolation, because the recognizer sees the
   * whole line's context.
   *
   * `"perBox"` reads every region on its own: n inferences, maximum crop isolation.
   * `"crossLine"` bin-packs lines into uniform batches for the fewest inferences.
   * All three report one result per region, so the geometry is unaffected.
   */
  readonly strategy?: RecognitionStrategy;
  /**
   * Longest side, in pixels, that the DETECTOR sees. The recognizer always works
   * from the full-resolution image, so this trades detection of small text against
   * detection time — it is not the resolution the text is read at.
   *
   * Default `"auto"`: `clamp(0.75 × longestSide, 960, 1920)`. An A4 page rendered at
   * 300 DPI is 3508 px tall, so it is detected at 1920. Raise it if small print goes
   * missing; a fixed 960 is the fastest.
   */
  readonly maxSideLength?: number | "auto";
  /**
   * Padding added around each detected region before it is read, as a fraction of
   * the region's height. The recognizer wants margin around the glyphs; these are
   * ppu-paddle-ocr's defaults, and they also inflate the boxes this loader reports —
   * see `lineTolerance`.
   */
  readonly paddingVertical?: number;
  readonly paddingHorizontal?: number;
  /**
   * Vertical band tolerance for grouping regions into lines, as a fraction of median
   * region height.
   *
   * The default is **derived from `paddingVertical`** rather than taken from core.
   * core bands at half the median box height, which for a text layer is half a line
   * of text — but a box PaddleOCR reports is `1 + 2 × paddingVertical` times the
   * text inside it, so the same 0.5 would band at 0.9 of a line here. Dividing by
   * the same factor makes the band proportional to the TEXT rather than to the
   * padding, so this loader groups like every other one: 0.28 at the default 0.4.
   *
   * On ordinary leading both settle identically; the difference is the margin before
   * a tight table starts merging rows.
   */
  readonly lineTolerance?: number;
  /**
   * How many pages to recognize at once. Both ONNX sessions are shared, so this
   * overlaps one page's image preprocessing with another's inference rather than
   * running two models at once. Default `"auto"`: 4 on CPU, 1 on an accelerator,
   * where parallel runs would only stack VRAM.
   */
  readonly concurrency?: number | "auto";
  /**
   * Where detection preprocessing happens. Default `"openCv"` — OpenCV.js, and more
   * accurate region detection. `"canvas"` skips the OpenCV WASM runtime entirely,
   * which is worth it in a constrained environment and costs some accuracy.
   */
  readonly imageEngine?: ImageEngine;
  /**
   * ONNX execution providers, most-preferred first — `["coreml", "cpu"]`,
   * `["cuda", "cpu"]`. Default `["cpu"]`. A provider that fails to initialise falls
   * back to CPU rather than failing the load.
   */
  readonly executionProviders?: readonly string[];
}

/**
 * Recognize image or rasterized PDF text with PaddleOCR ONNX models.
 *
 * @remarks DocumentLoaderPaddleOcrOptions configures the model, recognition strategy, concurrency and an optional PDF rasterizer. Dispose or await using releases the engine.
 * @throws MISSING_ENGINE when ppu-paddle-ocr or onnxruntime-node is absent; PAGE_OUT_OF_RANGE for unavailable selected pages. Recognition and rendering failures reject load.
 * @example
 * ```ts
 * import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
 * const loader = new DocumentLoaderPaddleOcr();
 * ```
 */
export class DocumentLoaderPaddleOcr implements DocumentLoader<LoaderCapabilities<true, true, true>> {
  readonly name = "paddleocr";

  /**
   * `text` and `geometry` because OCR reports positioned regions; `images` because
   * this loader necessarily has the pixels and a vision strategy may want them —
   * see {@link LoadedPage.image}.
   *
   * `mimeTypes` is the one part that depends on how the instance was built: with no
   * rasterizer wired there is no honest way to read a PDF, so it is not advertised.
   */
  readonly capabilities: LoaderCapabilities<true, true, true>;

  /** Created on first `load()`, reused across loads, released by `dispose()`. */
  private engine: PaddleEngine | undefined;

  constructor(private readonly options: DocumentLoaderPaddleOcrOptions = {}) {
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
    const recognized = await this.recognizeAll(read, await this.imagesOf(read, document.bytes, ctx.signal), ctx);

    // Rendering is memoized per page and per set of options, so asking twice costs
    // once — while a document nobody looks at costs nothing.
    const images = this.pageImages(document, mimeType, dpi, ctx);
    const pages = recognized.map(({ raster, image, recognition }) =>
      this.toPage(raster, "tiff" in raster ? image : undefined, recognition, images),
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
        ...(ctx.request?.pages === undefined ? { pageCount: rendered.length } : {}),
        pagesRead: pages.length,
        dpi,
        // The model NAME, or "custom" — never the paths, which may be a user's
        // directory layout and are not this library's to log.
        model:
          typeof this.options.model === "object"
            ? "custom"
            : (this.options.model ?? DEFAULT_MODEL),
        strategy: this.options.strategy ?? DEFAULT_STRATEGY,
        // Mean region confidence across the pages read, 0–1. Worth surfacing: a low
        // number is the signal to raise `dpi` or `maxSideLength`, or to hand the page
        // to a model instead.
        meanConfidence: Math.round(confidence * 1000) / 1000,
      },
    };
  }

  /** Release the ONNX sessions. Idempotent; a later `load()` builds a fresh engine. */
  async dispose(): Promise<void> {
    const engine = this.engine;
    this.engine = undefined;
    await engine?.destroy();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  // ── Pixels in ─────────────────────────────────────────────────────────────────

  /**
   * The images to recognize, one per page.
   *
   * Every page is rendered in one call, which is what the {@link Rasterizer}
   * contract allows — it exposes no page count to iterate against. That is also why
   * `maxPages` caps the OCR pass rather than the render: recognition is the part
   * that costs seconds per page, rendering is milliseconds.
   */
  private async render(
    document: RawDocument,
    mimeType: string,
    dpi: number,
    ctx: LoadContext,
  ): Promise<readonly OcrPage[]> {
    const pointsPerPixel = 72 / dpi;
    const images = IMAGE_MIME_TYPES as readonly string[];
    if (readsAsTiff(mimeType, document.bytes, images)) {
      return readableTiffPages(document.bytes, mimeType).map((tiff) => ({
        pageNumber: tiff.pageNumber,
        widthPx: tiff.widthPx,
        heightPx: tiff.heightPx,
        scale: pointsPerPixel,
        tiff,
      }));
    }
    if (images.includes(mimeType)) {
      const size = imageSize(document.bytes);
      if (size === undefined) {
        throw new Error(`paddleocr: these bytes are not a readable PNG or JPEG (${mimeType}).`);
      }
      return [{ pageNumber: 1, ...size, scale: pointsPerPixel, bytes: document.bytes }];
    }

    const rasterizer = this.options.rasterizer;
    if (rasterizer === undefined) {
      throw new Error(
        `paddleocr: ${mimeType} has to be rendered before it can be recognized, and no ` +
          `rasterizer is wired. Pass one — new DocumentLoaderPaddleOcr({ rasterizer: new ` +
          `NapiCanvasRasterizer() }) — or hand this loader a PNG, JPEG or TIFF.`,
      );
    }

    // PNG, always: the detector thresholds pixels, and JPEG artefacts around glyph
    // edges cost accuracy for a saving nobody here benefits from.
    const rendered = await rasterizer.rasterize(document, {
      dpi,
      format: "png",
      ...(ctx.request?.pages === undefined ? {} : { pages: ctx.request.pages }),
    }, ctx);
    if (rendered.length === 0) {
      throw new Error(`paddleocr: ${rasterizer.name} rendered no pages for this document.`);
    }
    return rendered;
  }

  private async imagesOf(
    pages: readonly OcrPage[],
    document: Uint8Array,
    signal: AbortSignal,
  ): Promise<readonly Uint8Array[]> {
    const tiff = pages.flatMap((page) => ("tiff" in page ? [page.tiff] : []));
    const decoded = tiff.length === 0 ? [] : await tiffPagesAsPng(document, tiff, signal);
    let next = 0;
    return pages.map((page) => ("tiff" in page ? decoded[next++]! : page.bytes));
  }

  // ── Text out ──────────────────────────────────────────────────────────────────

  /** OCR every page, and return them paired with the raster they came from. */
  private async recognizeAll(
    rasters: readonly OcrPage[],
    images: readonly Uint8Array[],
    ctx: LoadContext,
  ): Promise<readonly RecognizedPage[]> {
    const engine = (this.engine ??= new PaddleEngine({
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
      strategy: this.options.strategy ?? DEFAULT_STRATEGY,
      minConfidence: this.options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
      maxSideLength: this.options.maxSideLength ?? "auto",
      paddingVertical: this.options.paddingVertical ?? DEFAULT_PADDING_VERTICAL,
      paddingHorizontal: this.options.paddingHorizontal ?? DEFAULT_PADDING_HORIZONTAL,
      imageEngine: this.options.imageEngine ?? DEFAULT_IMAGE_ENGINE,
      ...(this.options.executionProviders === undefined
        ? {}
        : { executionProviders: this.options.executionProviders }),
    }));

    const recognitions = await engine.recognizeAll(
      images,
      {
        concurrency: this.options.concurrency ?? "auto",
        signal: ctx.signal,
        // Page COUNTS only. The logging convention here is ids, stages and timings —
        // never document text, and never anything recognized on the page.
        onProgress: (done, total) =>
          ctx.logger.debug("paddleocr: recognized a page", { done, total }),
      },
    );

    // A hole here would mean the batch reported success for a page it never ran; the
    // engine throws instead, so this is belt and braces rather than a real branch.
    return rasters.map((raster, index) => {
      const recognition = recognitions[index];
      if (recognition === undefined) {
        throw new Error(`paddleocr: page ${index + 1} produced no recognition.`);
      }
      return { raster, image: images[index]!, recognition };
    });
  }

  private toPage(
    raster: OcrPage,
    decoded: Uint8Array | undefined,
    recognition: Recognition,
    images: PageImages,
  ): LoadedPage {
    const words: PositionedWord[] = recognition.regions.map((region) => ({
      text: region.text,
      box: region.box,
      confidence: region.confidence,
    }));

    /**
     * PaddleOCR's own line grouping is deliberately discarded in favour of core's
     * `linesFromWords`, for two reasons.
     *
     * It is what makes an OCR'd page and a text-layer page group identically, so a
     * parser written against one works on the other.
     *
     * And it is more robust here. PaddleOCR compares the TOP EDGES of consecutive
     * regions against half the running average height of the line so far. Both halves
     * of that misjudge a mixed-size row: a 20pt heading beside 10pt text has a top
     * edge far enough above it to start a new line, and once a tall region does join a
     * line it raises the average, widening the threshold for whatever comes next.
     * core's bands on vertical CENTRES against the median height of the page, so
     * differently-sized text on one row stays on one row and a single outlier cannot
     * move the band.
     *
     * `scale` is points-per-pixel, so this is also where pixel boxes become the PDF
     * points every other loader reports.
     */
    const lines = linesFromWords(words, {
      scale: raster.scale,
      lineTolerance: this.lineTolerance(),
    });

    const pageNumber = raster.pageNumber;
    return {
      pageNumber,
      width: raster.widthPx * raster.scale,
      height: raster.heightPx * raster.scale,
      text: textFromLines(lines),
      lines,
      // A TIFF page serves the PNG it was decoded to: the original bytes are not an
      // image a vision model can take.
      image: (options?: RasterOptions, call?: { readonly signal?: AbortSignal }) =>
        images(pageNumber, options, call?.signal, decoded),
    };
  }

  /** The caller's band, or one derived from the padding. */
  private lineTolerance(): number {
    return (
      this.options.lineTolerance ??
      lineToleranceFor(this.options.paddingVertical ?? DEFAULT_PADDING_VERTICAL)
    );
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
}
