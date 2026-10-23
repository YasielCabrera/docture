/**
 * `PaddleOcrLoader` — read a document that has no text layer, by recognizing the
 * pixels, using PaddleOCR's ONNX models through ppu-paddle-ocr.
 *
 * The library is in the class name on purpose. Swapping to Tesseract is
 * `new TesseractJsLoader()`, and the conformance suite both classes pass is what
 * makes that a guarantee rather than a hope.
 *
 * OCR needs pixels, so this loader needs a way to get them:
 *
 * ```ts
 * // A scanned PDF: hand it a rasterizer, whichever library you prefer.
 * new PaddleOcrLoader({ rasterizer: new NapiCanvasRasterizer() });
 *
 * // A photograph or a scan already in PNG/JPEG: nothing else required.
 * new PaddleOcrLoader();
 * ```
 *
 * The rasterizer is a CONSTRUCTOR argument, not something looked up at run time, so
 * "no rasterizer wired" is visible where the loader is built rather than a throw
 * partway through someone's document. Without one, `application/pdf` is absent from
 * `capabilities.mimeTypes` — so the pipeline routes PDFs to another loader instead of
 * choosing this one and then failing.
 *
 * ## Against `TesseractJsLoader`
 *
 * Both read pixels and report the same shape, so this is a real choice rather than a
 * migration. PaddleOCR is a detect-then-recognize pair of neural networks; Tesseract
 * is a line recognizer with a layout analyser in front of it. In practice PaddleOCR
 * holds up better on photographs, rotated and low-contrast scans, and non-Latin
 * scripts, and it reports REGIONS the detector found rather than words — which is
 * coarser geometry. Tesseract gives a box per word and needs no ONNX runtime.
 * Neither is a subset of the other; if the documents matter, run both through
 * `docture/eval` and let the score decide.
 *
 * ## How it gets chosen
 *
 * The pipeline picks the first loader that ACCEPTS THE MEDIA TYPE and does not throw
 * — so listing this loader after a text-layer one is not a fallback chain:
 * `PdfJsLoader` "succeeds" on a scan, with `form: "scanned"` and no text, and OCR
 * never gets a turn. Two wirings that do work:
 *
 * ```ts
 * // 1. By media type. Disjoint, so each input has exactly one loader: PDFs go to the
 * //    text layer, photographs and scans-as-images go to OCR.
 * loaders: [new PdfJsLoader(), new PaddleOcrLoader()]
 *
 * // 2. As a real fallback, by making "no text layer" a thrown error — which IS what
 * //    hands the document to the next loader.
 * const pdfjs = new PdfJsLoader();
 * const textLayerOrBust = defineLoader({
 *   name: pdfjs.name,
 *   capabilities: pdfjs.capabilities,
 *   async load(document, ctx) {
 *     const loaded = await pdfjs.load(document, ctx);
 *     if (loaded.form === "scanned") throw new Error("pdfjs: no text layer to read");
 *     return loaded;
 *   },
 * });
 * loaders: [textLayerOrBust, new PaddleOcrLoader({ rasterizer })]
 * ```
 */

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
} from "../../core/index.js";
import {
  PaddleEngine,
  type ImageEngine,
  type PaddleModel,
  type PaddleModelFiles,
  type Recognition,
  type RecognitionStrategy,
} from "./paddle.js";

/**
 * What this loader will OCR without a rasterizer, and what it can size from a
 * header. Also exactly what a {@link Rasterizer} in this library emits.
 */
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const;

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

/** A rendered page paired with what OCR made of it. */
interface RecognizedPage {
  readonly raster: RasterPage;
  readonly recognition: Recognition;
}

export interface PaddleOcrLoaderOptions {
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
   * new PaddleOcrLoader({
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
   * Worth knowing that `TesseractJsLoader` defaults to 0 instead. The difference is
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

export class PaddleOcrLoader implements DocumentLoader<LoaderCapabilities<true, true, true>> {
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

  constructor(private readonly options: PaddleOcrLoaderOptions = {}) {
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
    const read = rendered.slice(0, this.options.maxPages ?? rendered.length);
    const recognized = await this.recognizeAll(read, ctx);

    // Rendering is memoized per page and per set of options, so asking twice costs
    // once — while a document nobody looks at costs nothing.
    const renders = new Map<string, Promise<Uint8Array>>();
    const pages = recognized.map(({ raster, recognition }) =>
      this.toPage(raster, recognition, document, mimeType, dpi, ctx, renders),
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
        pageCount: rendered.length,
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
  ): Promise<readonly RasterPage[]> {
    if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      const size = imageSize(document.bytes);
      if (size === undefined) {
        throw new Error(`paddleocr: these bytes are not a readable PNG or JPEG (${mimeType}).`);
      }
      return [
        {
          pageNumber: 1,
          bytes: document.bytes,
          widthPx: size.widthPx,
          heightPx: size.heightPx,
          format: mimeType === "image/jpeg" ? "jpeg" : "png",
          // An image carries no page size, so it is treated as a page scanned at
          // `dpi` — which is what makes its geometry comparable to a PDF's.
          scale: 72 / dpi,
        },
      ];
    }

    const rasterizer = this.options.rasterizer;
    if (rasterizer === undefined) {
      throw new Error(
        `paddleocr: ${mimeType} has to be rendered before it can be recognized, and no ` +
          `rasterizer is wired. Pass one — new PaddleOcrLoader({ rasterizer: new ` +
          `NapiCanvasRasterizer() }) — or hand this loader a PNG or JPEG.`,
      );
    }

    // PNG, always: the detector thresholds pixels, and JPEG artefacts around glyph
    // edges cost accuracy for a saving nobody here benefits from.
    const rendered = await rasterizer.rasterize(document, { dpi, format: "png" }, ctx);
    if (rendered.length === 0) {
      throw new Error(`paddleocr: ${rasterizer.name} rendered no pages for this document.`);
    }
    return rendered;
  }

  // ── Text out ──────────────────────────────────────────────────────────────────

  /** OCR every page, and return them paired with the raster they came from. */
  private async recognizeAll(
    rasters: readonly RasterPage[],
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
      rasters.map((raster) => raster.bytes),
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
      return { raster, recognition };
    });
  }

  private toPage(
    raster: RasterPage,
    recognition: Recognition,
    document: RawDocument,
    mimeType: string,
    dpi: number,
    ctx: LoadContext,
    renders: Map<string, Promise<Uint8Array>>,
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

    return {
      pageNumber: raster.pageNumber,
      width: raster.widthPx * raster.scale,
      height: raster.heightPx * raster.scale,
      text: textFromLines(lines),
      lines,
      image: (options?: RasterOptions) =>
        this.pageImage(raster, document, mimeType, dpi, options, ctx, renders),
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
  private pageImage(
    raster: RasterPage,
    document: RawDocument,
    mimeType: string,
    dpi: number,
    options: RasterOptions | undefined,
    ctx: LoadContext,
    renders: Map<string, Promise<Uint8Array>>,
  ): Promise<Uint8Array> {
    const rasterizer = this.options.rasterizer;
    // The input WAS an image. Re-encoding it to honour `format` or `dpi` would lose
    // quality to satisfy a request the bytes already answer.
    if (rasterizer === undefined || (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      return Promise.resolve(document.bytes);
    }

    const merged: RasterOptions = {
      dpi,
      format: "png",
      ...options,
      pages: [raster.pageNumber],
    };
    // The page number MUST be in the key: the cache is shared across every page of
    // the document, and keying on render options alone hands page 2 page 1's image.
    const key = JSON.stringify([
      raster.pageNumber,
      merged.dpi,
      merged.format,
      merged.quality,
      merged.maxEdge,
    ]);

    let pending = renders.get(key);
    if (pending === undefined) {
      pending = rasterizer
        .rasterize(document, merged, { signal: ctx.signal, logger: ctx.logger })
        .then((rendered) => {
          const first = rendered[0];
          if (first === undefined) {
            throw new Error(
              `${rasterizer.name} rendered no image for page ${raster.pageNumber}.`,
            );
          }
          return first.bytes;
        });
      renders.set(key, pending);
    }
    return pending;
  }
}
