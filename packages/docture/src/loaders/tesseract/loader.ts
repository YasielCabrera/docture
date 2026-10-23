/**
 * `TesseractJsLoader` — read a document that has no text layer, by recognizing the
 * pixels, using tesseract.js (Tesseract compiled to WASM; no native binary).
 *
 * The library is in the class name on purpose. Swapping to PaddleOCR is
 * `new PaddleOcrLoader()`, and the conformance suite both classes pass is what makes
 * that a guarantee rather than a hope.
 *
 * OCR needs pixels, so this loader needs a way to get them:
 *
 * ```ts
 * // A scanned PDF: hand it a rasterizer, whichever library you prefer.
 * new TesseractJsLoader({ rasterizer: new NapiCanvasRasterizer() });
 *
 * // A photograph or a scan already in PNG/JPEG: nothing else required.
 * new TesseractJsLoader();
 * ```
 *
 * The rasterizer is a CONSTRUCTOR argument, not something looked up at run time, so
 * "no rasterizer wired" is visible where the loader is built rather than a throw
 * partway through someone's document. Without one, `application/pdf` is absent from
 * `capabilities.mimeTypes` — so the pipeline routes PDFs to another loader instead of
 * choosing this one and then failing.
 *
 * It is worth being clear about what this costs. OCR is the slowest and least
 * accurate way to read a document: roughly 0.5–1.5 s per page against a text layer's
 * fraction of a millisecond, and it guesses where a text layer knows. Reach for it
 * when there is no text layer to read, not before.
 *
 * Which means being precise about how it gets chosen. The pipeline picks the first
 * loader that ACCEPTS THE MEDIA TYPE and does not throw — so listing this loader
 * after a text-layer one is not a fallback chain: `PdfJsLoader` "succeeds" on a scan,
 * with `form: "scanned"` and no text, and OCR never gets a turn. Two wirings that do
 * work:
 *
 * ```ts
 * // 1. By media type. Disjoint, so each input has exactly one loader: PDFs go to the
 * //    text layer, photographs and scans-as-images go to OCR.
 * loaders: [new PdfJsLoader(), new TesseractJsLoader()]
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
 * loaders: [textLayerOrBust, new TesseractJsLoader({ rasterizer })]
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
import { TesseractPool, type PageSegmentation, type Recognition } from "./tesseract.js";

/**
 * What this loader will OCR without a rasterizer, and what it can size from a
 * header. Also exactly what a {@link Rasterizer} in this library emits.
 */
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const;

/** 300 DPI is the usual floor for OCR accuracy; below ~200 it degrades sharply. */
const DEFAULT_DPI = 300;

/** A rendered page paired with what OCR made of it. */
interface RecognizedPage {
  readonly raster: RasterPage;
  readonly recognition: Recognition;
}

export interface TesseractJsLoaderOptions {
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
   * WASM engine and model (~100 MB), so this trades memory for wall-clock on a long
   * document. Default 1.
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

export class TesseractJsLoader implements DocumentLoader<LoaderCapabilities<true, true, true>> {
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

  constructor(private readonly options: TesseractJsLoaderOptions = {}) {
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
    const recognized = await this.recognizeAll(read, dpi, ctx);

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
        throw new Error(`tesseract: these bytes are not a readable PNG or JPEG (${mimeType}).`);
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
        `tesseract: ${mimeType} has to be rendered before it can be recognized, and no ` +
          `rasterizer is wired. Pass one — new TesseractJsLoader({ rasterizer: new ` +
          `NapiCanvasRasterizer() }) — or hand this loader a PNG or JPEG.`,
      );
    }

    // PNG, always: OCR reads thresholded pixels, and JPEG artefacts around glyph
    // edges cost accuracy for a saving nobody here benefits from.
    const rendered = await rasterizer.rasterize(document, { dpi, format: "png" }, ctx);
    if (rendered.length === 0) {
      throw new Error(`tesseract: ${rasterizer.name} rendered no pages for this document.`);
    }
    return rendered;
  }

  // ── Text out ──────────────────────────────────────────────────────────────────

  /**
   * OCR every page, up to `concurrency` at a time, and return them in page order.
   */
  private async recognizeAll(
    rasters: readonly RasterPage[],
    dpi: number,
    ctx: LoadContext,
  ): Promise<readonly RecognizedPage[]> {
    // One normalization for both the pool's size and the fan-out below, so a
    // fractional or zero `concurrency` cannot make them disagree.
    const concurrency = Math.max(1, Math.floor(this.options.concurrency ?? 1));

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
          const recognition = await pool.recognize(raster.bytes, { autoRotate });
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
    raster: RasterPage,
    recognition: Recognition,
    document: RawDocument,
    mimeType: string,
    dpi: number,
    ctx: LoadContext,
    renders: Map<string, Promise<Uint8Array>>,
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

  private languages(): readonly string[] {
    const languages = this.options.languages ?? ["eng"];
    if (languages.length === 0) {
      throw new Error("tesseract: `languages` cannot be empty; pass at least one, e.g. ['eng'].");
    }
    return languages;
  }
}
