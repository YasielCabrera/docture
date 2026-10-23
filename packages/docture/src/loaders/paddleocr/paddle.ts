/**
 * The ppu-paddle-ocr engine, encapsulated: lazy module load, one service instance,
 * and the handful of its defaults that are wrong for reading a document.
 *
 * `await import()` at FIRST USE rather than at module import: constructing a
 * `PaddleOcrLoader` must be free, and a pipeline that never OCRs a page must not pay
 * for loading onnxruntime-node's native addon or instantiating an OpenCV WASM
 * runtime.
 *
 * Three things this file exists to get right, each a wrong answer otherwise:
 *
 *  - **The result cache is bypassed.** ppu-paddle-ocr memoizes recognition in a
 *    process-global LRU keyed on a 32-bit hash of an image's FIRST 1024 BYTES plus
 *    its length. Two pages of the same scan share a PNG header, so the key is
 *    substantially "page size and compressed length" — and a collision serves one
 *    page the other page's text, silently. The key also omits every option that
 *    changes the answer, so two loaders configured differently in one process
 *    collide by construction. `noCache` on every call is the only correct setting;
 *    what a loader legitimately wants to memoize, it memoizes itself.
 *  - **Bytes become an exactly-sized `ArrayBuffer`.** The engine takes
 *    `ArrayBuffer | Canvas` and treats anything that is not an `ArrayBuffer` as a
 *    canvas — so a `Uint8Array` reaches `.getContext()` and dies. Handing over
 *    `bytes.buffer` instead is worse than a crash: Node pools small buffers, so that
 *    is frequently an 8 KB slab holding unrelated data, and the engine would decode
 *    the slab.
 *  - **Nothing is written to the working directory.** `debug: true` dumps
 *    intermediate crops to `./out`. It stays off, and is not exposed.
 *
 * The library's types are deliberately NOT imported. They reach into
 * `onnxruntime-common` for session options, and a structural slice keeps both that
 * and every ppu-paddle-ocr name out of this package's public API.
 */

import { importEngine } from "../../core/engines.js";

/** One recognized region as PaddleOCR reports it. */
export interface Recognized {
  readonly text: string;
  /** `[x0, y0, x1, y1]` in PIXELS of the image that was recognized. */
  readonly box: readonly [number, number, number, number];
  /** 0–1. */
  readonly confidence: number;
}

export interface Recognition {
  readonly regions: readonly Recognized[];
  /** Mean confidence across the page's regions, 0–1. */
  readonly confidence: number;
}

/**
 * How the recognizer batches the regions the detector found.
 *
 * Every mode returns one result per detected region either way — `perLine` and
 * `crossLine` stitch crops together for the inference pass and split the text back
 * out by the decoder's own character positions. So this trades inference count for
 * accuracy without changing the SHAPE of what comes back.
 */
export const RECOGNITION_STRATEGIES = {
  /** One inference per region. Most isolated, and the slowest. */
  perBox: "per-box",
  /** Regions on a line are stitched and read together. The library's default. */
  perLine: "per-line",
  /** Lines are bin-packed into uniform-width batches. Fewest inferences. */
  crossLine: "cross-line",
} as const satisfies Record<string, string>;

export type RecognitionStrategy = keyof typeof RECOGNITION_STRATEGIES;

/**
 * Which PaddleOCR model bundle to run — the equivalent of a language choice, since
 * PaddleOCR ships a recognizer per script rather than one model per language.
 *
 * Mirrors ppu-paddle-ocr's own preset keys, which is what keeps their URLs out of
 * this file: the name is resolved against the library's catalogue at first use. The
 * default is `v6Tiny`, the library's own.
 */
export const PADDLE_MODELS = {
  /** PP-OCRv6 tiny — fastest; ~6.9k-character dictionary. The default. */
  v6Tiny: "v6-tiny",
  /** PP-OCRv6 small — 50+ languages, the best accuracy/speed balance. */
  v6Small: "v6-small",
  /** PP-OCRv6 medium — server-grade, the most accurate on offer. */
  v6Medium: "v6-medium",
  /** PP-OCRv5 English mobile. */
  v5EnglishMobile: "v5-en-mobile",
  /** PP-OCRv5 English mobile, INT8-quantized — smaller and faster, less accurate. */
  v5EnglishMobileInt8: "v5-en-mobile-int8",
  /** PP-OCRv5 English server. */
  v5EnglishServer: "v5-en-server",
  /** PP-OCRv5 mobile — the multilingual Latin/CJK model. */
  v5Mobile: "v5-mobile",
  /** PP-OCRv5 server — the multilingual Latin/CJK model, server-grade. */
  v5Server: "v5-server",
  v5Arabic: "v5-arabic-mobile",
  v5Cyrillic: "v5-cyrillic-mobile",
  v5Devanagari: "v5-devanagari-mobile",
  v5EastSlavic: "v5-eslav-mobile",
  v5Greek: "v5-greek-mobile",
  v5Korean: "v5-korean-mobile",
  v5Latin: "v5-latin-mobile",
  v5Tamil: "v5-tamil-mobile",
  v5Telugu: "v5-telugu-mobile",
  v5Thai: "v5-thai-mobile",
  v4EnglishMobile: "v4-en-mobile",
  v4Mobile: "v4-mobile",
  v4Server: "v4-server",
  /** PP-OCRv4 server, tuned for documents rather than scene text. */
  v4ServerDocument: "v4-server-doc",
  v3Mobile: "v3-mobile",
  v3Japanese: "v3-japanese-mobile",
} as const satisfies Record<string, string>;

export type PaddleModel = keyof typeof PADDLE_MODELS;

/**
 * An ONNX file, or a dictionary file: a path, a URL, or the bytes themselves.
 *
 * The point of accepting all three is running offline — see {@link PaddleModelFiles}.
 */
export type ModelSource = string | Uint8Array;

/**
 * The three files a PaddleOCR pipeline needs, named explicitly.
 *
 * Pass this instead of a {@link PaddleModel} to run against vendored models with no
 * network access, or to run a model the catalogue does not list.
 */
export interface PaddleModelFiles {
  /** The text DETECTION model — finds the regions. */
  readonly detection: ModelSource;
  /** The text RECOGNITION model — reads what is in them. */
  readonly recognition: ModelSource;
  /** The character dictionary the recognizer decodes against. */
  readonly charactersDictionary: ModelSource;
}

/** Where detection preprocessing and recognition resizing happen. */
export const IMAGE_ENGINES = {
  /** OpenCV.js, via `ppu-ocv`. More accurate region detection. The default. */
  openCv: "opencv",
  /** Plain canvas operations. No OpenCV WASM runtime to instantiate. */
  canvas: "canvas-native",
} as const satisfies Record<string, string>;

export type ImageEngine = keyof typeof IMAGE_ENGINES;

export interface EngineOptions {
  /** A catalogue preset, or the three files spelled out. */
  readonly model?: PaddleModel | PaddleModelFiles;
  readonly strategy: RecognitionStrategy;
  /** Drop regions below this confidence, 0–1. PaddleOCR's `drop_score`. */
  readonly minConfidence: number;
  /** Longest side, in pixels, the DETECTOR sees. `"auto"` scales with the input. */
  readonly maxSideLength: number | "auto";
  /** Padding added to each detected region, as a fraction of its height. */
  readonly paddingVertical: number;
  readonly paddingHorizontal: number;
  readonly imageEngine: ImageEngine;
  /** ONNX execution providers, most-preferred first. */
  readonly executionProviders?: readonly string[];
}

export interface RecognizeBatchOptions {
  /** Pages recognized at once. `"auto"` lets the library decide. */
  readonly concurrency: number | "auto";
  readonly signal: AbortSignal;
  readonly onProgress?: (done: number, total: number | undefined) => void;
}

// ── The slice of ppu-paddle-ocr used here ───────────────────────────────────────
// Structural, so no ppu-paddle-ocr type reaches this package's public API.

interface PaddleBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PaddleRegion {
  readonly text: string;
  readonly box: PaddleBox;
  readonly confidence: number;
}

/** What `flatten: true` returns: the regions as found, ungrouped. */
interface PaddleFlatResult {
  readonly text: string;
  readonly results: readonly PaddleRegion[];
  readonly confidence: number;
}

interface PaddleServiceOptions {
  readonly model?: Record<string, string | ArrayBuffer>;
  readonly detection?: Record<string, unknown>;
  readonly recognition?: Record<string, unknown>;
  readonly debugging?: Record<string, unknown>;
  readonly processing?: Record<string, unknown>;
  readonly session?: Record<string, unknown>;
}

interface PaddleService {
  initialize(): Promise<void>;
  batchRecognize(
    images: readonly ArrayBuffer[],
    options: Record<string, unknown>,
  ): Promise<readonly unknown[]>;
  destroy(): Promise<void>;
}

interface PaddleServiceConstructor {
  new (options?: PaddleServiceOptions): PaddleService;
}

interface PaddleExports {
  readonly PaddleOcrService: PaddleServiceConstructor;
  /** Preset key → the three URLs. Read rather than duplicated here. */
  readonly MODEL_PRESETS: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

let cached: Promise<PaddleExports> | undefined;

async function loadPaddle(): Promise<PaddleExports> {
  cached ??= (async () => {
    // The engine imports ONNX Runtime itself, so a missing runtime surfaces here too.
    const module = (await importEngine(
      "docture/loaders/paddleocr",
      ["ppu-paddle-ocr", "onnxruntime-node"],
      () => import("ppu-paddle-ocr"),
    )) as unknown as Partial<PaddleExports>;
    if (typeof module.PaddleOcrService !== "function") {
      throw new Error(
        "ppu-paddle-ocr did not export PaddleOcrService; is the install intact?",
      );
    }
    return module as PaddleExports;
  })();
  return cached;
}

/**
 * `bytes` as an `ArrayBuffer` the engine will accept, without handing over more than
 * the bytes.
 *
 * A `Uint8Array` from a rasterizer is frequently a window onto a larger allocation —
 * Node pools buffers under 8 KB, and `canvas.toBuffer()` returns a Node `Buffer`. So
 * `bytes.buffer` is the wrong object to pass whenever the view is not the whole
 * thing, and the copy below is not paranoia.
 *
 * Exported for its test, not from the package: it is exactly the kind of function
 * that looks obviously right and is silently wrong.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const exact =
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer;
  if (exact) return bytes.buffer as ArrayBuffer;
  // NOT `bytes.slice()`: Node's `Buffer` overrides `slice` to return a VIEW rather
  // than a copy, so on the one input this function exists for it would hand back the
  // pool it was trying to escape. The constructor copies whatever it is given.
  return new Uint8Array(bytes).buffer;
}

/** A `ModelSource` in the form the engine takes. */
function toModelSource(source: ModelSource): string | ArrayBuffer {
  return typeof source === "string" ? source : toArrayBuffer(source);
}

/**
 * The engine, as one object with a lifetime.
 *
 * A PaddleOCR pipeline is two ONNX sessions plus a decoded dictionary; building them
 * costs a model download on the very first run and a few hundred milliseconds every
 * time after. So it is built once, on first use, and reused until `destroy()`.
 */
export class PaddleEngine {
  private service: PaddleService | undefined;
  /** In flight, so two concurrent first loads share one initialization. */
  private starting: Promise<PaddleService> | undefined;
  /**
   * Bumped by `destroy()`. A start that finishes on an older generation knows its
   * service was released out from under it — which a `this.starting === undefined`
   * check could not tell apart from "the other concurrent starter got there first".
   */
  private generation = 0;

  constructor(private readonly options: EngineOptions) {}

  /**
   * Recognize every image, in page order, with the failure of any one page ending
   * the batch.
   *
   * Delegated to the library's own bounded-concurrency pool rather than hand-rolled:
   * it aligns results to inputs by index, honours an `AbortSignal` between pages, and
   * keeps at most `concurrency` images decoded at once.
   */
  async recognizeAll(
    images: readonly Uint8Array[],
    options: RecognizeBatchOptions,
  ): Promise<readonly Recognition[]> {
    const service = await this.start();
    options.signal.throwIfAborted();

    const results = await service.batchRecognize(images.map(toArrayBuffer), {
      // The regions as detected, rather than the library's own line grouping — see
      // the note in `loader.ts` on why grouping goes through core instead.
      flatten: true,
      // Not negotiable; see the note at the top of this file.
      noCache: true,
      strategy: RECOGNITION_STRATEGIES[this.options.strategy],
      concurrency: options.concurrency,
      // `settle: false` — one unreadable page ends the load rather than burning
      // minutes on the rest and reporting a hole as success.
      settle: false,
      signal: options.signal,
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });

    return results.map((result, index) => toRecognition(result, index));
  }

  /**
   * Release the ONNX sessions. Idempotent; a later `recognizeAll()` builds a fresh
   * engine.
   */
  async destroy(): Promise<void> {
    this.generation += 1;
    // Take the pending initialization too: disposing mid-start must not leave a
    // service nobody holds a reference to still holding two ONNX sessions.
    const pending = this.starting;
    const service = this.service;
    this.starting = undefined;
    this.service = undefined;

    if (pending !== undefined) {
      // A build that failed has nothing to release, and its error belongs to the
      // load that asked for it — not to whoever called `dispose()`.
      await pending.then((started) => started.destroy()).catch(() => {});
      return;
    }
    await service?.destroy();
  }

  private async start(): Promise<PaddleService> {
    const running = this.service;
    if (running !== undefined) return running;

    const generation = this.generation;
    const starting = (this.starting ??= this.build());

    let service: PaddleService;
    try {
      service = await starting;
    } catch (error) {
      // A failed build must not be cached, or every later load replays the failure
      // rather than retrying — a download that timed out is worth a second attempt.
      if (this.starting === starting) this.starting = undefined;
      throw error;
    }

    if (this.generation !== generation) {
      throw new Error("paddleocr: the engine was disposed while it was starting.");
    }
    this.service = service;
    if (this.starting === starting) this.starting = undefined;
    return service;
  }

  private async build(): Promise<PaddleService> {
    const { PaddleOcrService } = await loadPaddle();
    const options = await this.serviceOptions();
    const service = new PaddleOcrService(options);
    await service.initialize();
    return service;
  }

  private async serviceOptions(): Promise<PaddleServiceOptions> {
    const model = await this.resolveModel();
    const { executionProviders } = this.options;
    return {
      ...(model === undefined ? {} : { model }),
      detection: {
        maxSideLength: this.options.maxSideLength,
        paddingVertical: this.options.paddingVertical,
        paddingHorizontal: this.options.paddingHorizontal,
      },
      recognition: {
        strategy: RECOGNITION_STRATEGIES[this.options.strategy],
        minimumConfidence: this.options.minConfidence,
      },
      processing: { engine: IMAGE_ENGINES[this.options.imageEngine] },
      // Explicit, because `debug: true` writes crops into the working directory.
      debugging: { verbose: false, debug: false },
      ...(executionProviders === undefined
        ? {}
        : { session: { executionProviders: [...executionProviders] } }),
    };
  }

  /**
   * The three model files, or `undefined` to let the library use its default.
   *
   * A preset name is looked up in the library's own catalogue rather than mirrored
   * here, so the URLs cannot drift out of date — at the cost of having to fail
   * clearly if a name is ever retired.
   */
  private async resolveModel(): Promise<Record<string, string | ArrayBuffer> | undefined> {
    const { model } = this.options;
    if (model === undefined) return undefined;

    if (typeof model !== "string") {
      return {
        detection: toModelSource(model.detection),
        recognition: toModelSource(model.recognition),
        charactersDictionary: toModelSource(model.charactersDictionary),
      };
    }

    const key = PADDLE_MODELS[model];
    const { MODEL_PRESETS } = await loadPaddle();
    const preset = MODEL_PRESETS[key];
    if (preset === undefined) {
      throw new Error(
        `paddleocr: ppu-paddle-ocr no longer publishes the "${key}" model preset. ` +
          `Pass explicit model files instead — new PaddleOcrLoader({ model: { detection, ` +
          `recognition, charactersDictionary } }).`,
      );
    }
    return { ...preset };
  }
}

/** One page's result, validated on the way out of a structurally-typed boundary. */
function toRecognition(result: unknown, index: number): Recognition {
  if (!isFlatResult(result)) {
    throw new Error(
      `paddleocr: page ${index + 1} produced no recognition. This is a ppu-paddle-ocr ` +
        `contract change, not a bad document.`,
    );
  }

  const regions = result.results.map(
    (region): Recognized => ({
      text: region.text,
      // `{x, y, width, height}` in the original image's pixels, to the
      // `[x0, y0, x1, y1]` every producer in this library reports.
      box: [
        region.box.x,
        region.box.y,
        region.box.x + region.box.width,
        region.box.y + region.box.height,
      ],
      confidence: region.confidence,
    }),
  );

  return { regions, confidence: Math.max(0, Math.min(1, result.confidence)) };
}

function isFlatResult(value: unknown): value is PaddleFlatResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PaddleFlatResult>;
  return Array.isArray(candidate.results) && typeof candidate.confidence === "number";
}
