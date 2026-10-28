/**
 * The tesseract.js engine, encapsulated: lazy module load, a worker pool, and the
 * handful of defaults tesseract.js will otherwise make the caller's problem.
 *
 * `await import()` at FIRST USE rather than at module import: constructing a
 * `DocumentLoaderTesseract` must be free, and a pipeline that never OCRs a page must not
 * pay for spawning a worker thread or instantiating a WASM engine.
 *
 * Four things this file exists to get right, each of which is a silent wrong answer
 * or a crashed process otherwise:
 *
 *  - **Page segmentation.** tesseract.js initialises Tesseract at `--psm 6`
 *    ("assume a single uniform block of text"), not the `--psm 3` the tesseract CLI
 *    uses. On an invoice that difference is not subtle: at 6, layout analysis finds
 *    one block and the 20pt "INVOICE" heading is dropped from the output entirely.
 *    Every worker here is initialised with an explicit mode, defaulting to auto.
 *  - **Resolution.** Tesseract guesses the DPI from the pixel dimensions and prints
 *    "Estimating resolution as 350" to stderr for every page. We rendered the page,
 *    so we know the real number — `user_defined_dpi` tells it, which both silences
 *    the warning and stops it choosing thresholds for a resolution we did not use.
 *  - **Error delivery.** With no `errorHandler`, tesseract.js does
 *    `throw Error(data)` *inside* its own worker-message handler, which in Node is an
 *    uncaught exception that takes the process down. The job promise is rejected with
 *    the same value first, so a no-op handler loses nothing and keeps a bad page from
 *    killing the host.
 *  - **Where the model lands.** The default `cachePath` is `"."`, so first use drops
 *    a 5 MB `eng.traineddata` in whatever directory the process happens to be in.
 *    We default it to a real cache directory instead.
 */

import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { importEngine, lazyEngine } from "../../core/engines.js";

/** One word as Tesseract reports it: text, a pixel box, and 0–1 confidence. */
export interface RecognizedWord {
  readonly text: string;
  /** `[x0, y0, x1, y1]` in PIXELS of the image that was recognized. */
  readonly box: readonly [number, number, number, number];
  /** 0–1. Tesseract reports 0–100; normalized here. */
  readonly confidence: number;
}

export interface Recognition {
  readonly words: readonly RecognizedWord[];
  /** Mean confidence for the page, 0–1. */
  readonly confidence: number;
  readonly image?: Uint8Array;
}

/** Tesseract's `--psm` numbers — the documented, stable CLI interface. */
export const PAGE_SEGMENTATION_MODES = {
  /** Full layout analysis. `--psm 3`, and what the tesseract CLI defaults to. */
  auto: "3",
  /** One column of text of variable sizes. `--psm 4`. */
  singleColumn: "4",
  /** One uniform block. `--psm 6` — tesseract.js's own default. */
  singleBlock: "6",
  /** One text line. `--psm 7`. */
  singleLine: "7",
  /** Sparse text, no particular order — receipts, forms, labels. `--psm 11`. */
  sparse: "11",
} as const satisfies Record<string, string>;

export type PageSegmentation = keyof typeof PAGE_SEGMENTATION_MODES;

export interface EngineOptions {
  /** Traineddata languages, e.g. `["eng"]` or `["eng", "deu"]`. */
  readonly languages: readonly string[];
  /** Maximum number of concurrent workers. */
  readonly concurrency: number;
  /** The resolution the images were rendered at, for `user_defined_dpi`. */
  readonly dpi: number;
  readonly pageSegmentation: PageSegmentation;
  /** Where to find `<lang>.traineddata`. A directory or URL; omit for the CDN. */
  readonly langPath?: string;
  /** Where downloaded traineddata is cached. */
  readonly cachePath?: string;
  /** Raw Tesseract variables, applied last. The escape hatch. */
  readonly parameters?: Readonly<Record<string, string>>;
}

export interface RecognizeOptions {
  /** Let Tesseract detect and correct page skew before recognizing. */
  readonly autoRotate: boolean;
  readonly returnDecodedPng?: boolean;
}

// ── The slice of tesseract.js used here ─────────────────────────────────────────
// Structural, so no tesseract.js type reaches this package's public API.

interface TesseractBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface TesseractWord {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: TesseractBox;
}

interface TesseractPage {
  readonly text: string;
  readonly confidence: number;
  /** A `data:image/png;base64,` URL when the recognition asked for `imageColor`. */
  readonly imageColor?: string | null;
  /** `null` unless the recognition asked for `blocks`. */
  readonly blocks: readonly {
    readonly paragraphs: readonly { readonly lines: readonly { readonly words: readonly TesseractWord[] }[] }[];
  }[] | null;
}

interface TesseractWorker {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(
    image: Uint8Array,
    options: Record<string, unknown>,
    output: Record<string, boolean>,
  ): Promise<{ readonly data: TesseractPage }>;
  terminate(): Promise<unknown>;
}

interface TesseractModule {
  createWorker(
    langs: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<TesseractWorker>;
}

/** LSTM only. The legacy engine needs a second, much larger model file. */
const OEM_LSTM_ONLY = 1;

const loadTesseract = lazyEngine(async (): Promise<TesseractModule> => {
  // tesseract.js is CommonJS; Node's interop exposes the named exports, but a
  // bundler may hand back only `default`. Accept either.
  const module = (await importEngine("docture/loaders/tesseract", ["tesseract.js"], () =>
    import("tesseract.js"),
  )) as unknown as
    | TesseractModule
    | { default: TesseractModule };
  const resolved = "createWorker" in module ? module : module.default;
  if (typeof resolved?.createWorker !== "function") {
    throw new Error("tesseract.js did not export createWorker; is the install intact?");
  }
  return resolved;
});

/**
 * Where traineddata is cached when the caller does not say.
 *
 * Anywhere but the working directory: a library that leaves a 5 MB file in `cwd`
 * on first use is a library that shows up in someone's `git status`.
 */
export function defaultCachePath(): string {
  const base = process.env["XDG_CACHE_HOME"] ?? join(homedir() || tmpdir(), ".cache");
  return join(base, "docture", "tesseract");
}

/**
 * A fixed-size pool of Tesseract workers, shared across `load()` calls.
 *
 * Worker startup is the expensive part — a thread, a WASM instantiation and a model
 * read each time — so workers are created on demand up to `concurrency` and then
 * reused until `dispose()`. The default leaves one available CPU free and caps the
 * pool at four workers. The recorded four-page, 300 DPI benchmark used about
 * 210 MiB more memory per extra worker.
 */
export class TesseractPool {
  private readonly all = new Set<TesseractWorker>();
  private readonly idle: TesseractWorker[] = [];
  private readonly waiting: {
    resolve: (worker: TesseractWorker) => void;
    reject: (error: unknown) => void;
  }[] = [];
  private readonly spawning = new Set<Promise<TesseractWorker>>();
  private disposed = false;
  private terminating: Promise<void> | undefined;
  private readonly terminationFailures: unknown[] = [];

  constructor(private readonly options: EngineOptions) {}

  /** Recognize one image. Queues when every worker is busy. */
  async recognize(image: Uint8Array, options: RecognizeOptions): Promise<Recognition> {
    const worker = await this.acquire();
    try {
      const result = await worker.recognize(
        image,
        options.autoRotate ? { rotateAuto: true } : {},
        // `blocks` is off by default in tesseract.js v7 and is the only source of
        // word geometry — without it there is text but nothing positioned.
        { text: true, blocks: true, ...(options.returnDecodedPng === true ? { imageColor: true } : {}) },
      );
      return toRecognition(result.data, options.returnDecodedPng === true);
    } catch (error) {
      // tesseract.js rejects with a plain string, which loses the stack and reads
      // badly anywhere a caller expects an Error.
      throw error instanceof Error ? error : new Error(`tesseract failed: ${String(error)}`);
    } finally {
      this.release(worker);
    }
  }

  /**
   * Terminate every worker. Safe to call twice — the second call has nothing left
   * to do, which is what `dispose()` on a loader has to tolerate.
   */
  terminate(): Promise<void> {
    this.disposed = true;
    this.terminating ??= this.terminateAll();
    return this.terminating;
  }

  private async terminateAll(): Promise<void> {
    const workers = [...this.all];
    const stranded = [...this.waiting];
    this.all.clear();
    this.idle.length = 0;
    this.waiting.length = 0;

    // Anyone queued for a worker will never get one now. Failing them is the only
    // honest answer — leaving the promise unsettled would hang the caller's load.
    for (const waiter of stranded) {
      waiter.reject(new Error("tesseract: the engine was disposed while this page was queued."));
    }

    await Promise.allSettled([
      ...workers.map((worker) => this.terminateWorker(worker)),
      ...[...this.spawning].map((pending) => pending.then(() => undefined, () => undefined)),
    ]);
    if (this.terminationFailures.length > 0) {
      throw new AggregateError(this.terminationFailures, "Some Tesseract workers failed to terminate.");
    }
  }

  private async terminateWorker(worker: TesseractWorker): Promise<void> {
    try {
      await worker.terminate();
    } catch (error) {
      this.terminationFailures.push(error);
      throw error;
    }
  }

  private async acquire(): Promise<TesseractWorker> {
    if (this.disposed) throw new Error("tesseract: the engine was disposed while this page was queued.");
    const free = this.idle.pop();
    if (free !== undefined) return free;

    if (this.all.size + this.spawning.size < this.options.concurrency) {
      const pending = this.spawn().then(async (worker) => {
        if (this.disposed) {
          await this.terminateWorker(worker);
          throw new Error("tesseract: the engine was disposed while this page was starting.");
        }
        this.all.add(worker);
        return worker;
      });
      this.spawning.add(pending);
      try {
        return await pending;
      } catch (error) {
        if (!this.disposed && this.all.size === 0 && this.spawning.size === 1) {
          for (const waiter of this.waiting.splice(0)) waiter.reject(error);
        }
        throw error;
      } finally {
        this.spawning.delete(pending);
      }
    }

    return new Promise<TesseractWorker>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  private release(worker: TesseractWorker): void {
    // A terminated pool must not hand the worker back out.
    if (!this.all.has(worker)) return;
    const next = this.waiting.shift();
    if (next === undefined) this.idle.push(worker);
    else next.resolve(worker);
  }

  private async spawn(): Promise<TesseractWorker> {
    const { createWorker } = await loadTesseract();
    const cachePath = this.options.cachePath ?? defaultCachePath();
    // Tesseract swallows a failed cache write and re-downloads next time, so a
    // missing directory is a slow success rather than an error. Make it anyway.
    await mkdir(cachePath, { recursive: true }).catch(() => {});

    const worker = await createWorker(this.options.languages.join("+"), OEM_LSTM_ONLY, {
      cachePath,
      ...(this.options.langPath === undefined ? {} : { langPath: this.options.langPath }),
      // Present so tesseract.js does not throw from inside its own message handler;
      // the rejected job promise is what actually reports the failure.
      errorHandler: () => {},
    });

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PAGE_SEGMENTATION_MODES[this.options.pageSegmentation],
        user_defined_dpi: String(Math.round(this.options.dpi)),
        ...this.options.parameters,
      });
    } catch (error) {
      await this.terminateWorker(worker).catch(() => undefined);
      throw error;
    }

    return worker;
  }
}

/** Flatten Tesseract's block → paragraph → line → word tree into words. */
function toRecognition(page: TesseractPage, withImage: boolean): Recognition {
  const words: RecognizedWord[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({
            text: word.text,
            box: [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1],
            confidence: word.confidence / 100,
          });
        }
      }
    }
  }
  // Tesseract reports -1 for a page it recognized nothing on.
  const confidence = Math.max(0, page.confidence) / 100;
  if (!withImage) return { words, confidence };
  const url = page.imageColor;
  if (typeof url !== "string" || !url.startsWith("data:image/png;base64,")) {
    throw new Error("tesseract: the engine returned no PNG for a page image that was requested.");
  }
  return { words, confidence, image: Uint8Array.from(Buffer.from(url.slice(url.indexOf(",") + 1), "base64")) };
}
