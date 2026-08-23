/**
 * `LLM` — a model, and everything it can be turned into.
 *
 * `@docture/core` deliberately does not depend on the AI SDK, so it cannot accept a
 * `LanguageModel` directly. It accepts a {@link ModelBackend} instead: something that
 * knows how to produce the strategies core already understands. This is that thing.
 *
 * ```ts
 * const extractor = new Extractor()
 *   .loadDocumentLoader(new DocumentLoaderPdfJs())
 *   .loadLlm(new LLM(openai("gpt-5")));
 *
 * // or, with everything a scanned mixed bundle needs:
 * .loadLlm(new LLM(openai("gpt-5")), { vision: true, classify: true })
 * ```
 *
 * Configure once, here, and every strategy this model produces inherits it — one
 * cache, one pricing table, one set of instructions, rather than three call sites
 * that can drift.
 */

import type { LanguageModel } from "ai";
import type {
  Classifier,
  CompletionStrategy,
  ExtractionStrategy,
  LayoutAnalyzer,
  ModelBackend,
  Splitter,
} from "@docture/core";
import type { LlmCache } from "./cache.js";
import { LlmClassifier, type LlmClassifierOptions } from "./classifier.js";
import { LlmLayoutAnalyzer, type LlmLayoutAnalyzerOptions } from "./layout.js";
import type { PricingTable } from "./pricing.js";
import { ImageSplitter, TextSplitter, type SplitterOptions } from "./split.js";
import { LlmStrategy, modelIdOf, type LlmStrategyOptions } from "./strategy.js";
import { VisionStrategy, type VisionStrategyOptions } from "./vision.js";

type Shared<T> = Omit<T, "model">;

export interface LlmOptions {
  /** Strategy id prefix. Defaults to the model id, so two models never collide. */
  readonly name?: string;
  /** Default `"forbidden"` — one request, which is what most documents need. */
  readonly completion?: CompletionStrategy;
  /** Appended to every system prompt — the usual place for domain guidance. */
  readonly instructions?: string;
  /** Shared by every strategy this model produces. */
  readonly cache?: LlmCache;
  /** USD per million tokens. Without it, `costUsd` stays honestly undefined. */
  readonly pricing?: PricingTable;
  /** Default 0 — extraction should be reproducible. */
  readonly temperature?: number;
  readonly maxRetries?: number;
  /** Overrides for the text extraction strategy. */
  readonly extraction?: Shared<LlmStrategyOptions>;
  /** Overrides for the vision strategy. */
  readonly vision?: Shared<VisionStrategyOptions>;
  /** Overrides for the classifier. */
  readonly classifier?: Shared<LlmClassifierOptions>;
  /** Overrides for conversion layout assistance. */
  readonly layout?: Shared<LlmLayoutAnalyzerOptions>;
  /** Overrides for the splitter, and which kind to build. */
  readonly splitter?: Shared<SplitterOptions> & { readonly mode?: "text" | "image" };
}

export class LLM implements ModelBackend {
  readonly id: string;
  readonly model: LanguageModel;
  readonly #options: LlmOptions;

  constructor(model: LanguageModel, options: LlmOptions = {}) {
    this.model = model;
    this.id = options.name ?? modelIdOf(model);
    this.#options = options;
  }

  /** The defaults every strategy from this model starts with. */
  get #shared(): {
    model: LanguageModel;
    cache?: LlmCache;
    pricing?: PricingTable;
    temperature?: number;
    maxRetries?: number;
    instructions?: string;
  } {
    const o = this.#options;
    return {
      model: this.model,
      ...(o.cache === undefined ? {} : { cache: o.cache }),
      ...(o.pricing === undefined ? {} : { pricing: o.pricing }),
      ...(o.temperature === undefined ? {} : { temperature: o.temperature }),
      ...(o.maxRetries === undefined ? {} : { maxRetries: o.maxRetries }),
      ...(o.instructions === undefined ? {} : { instructions: o.instructions }),
    };
  }

  extraction(): ExtractionStrategy {
    const o = this.#options;
    return new LlmStrategy({
      ...this.#shared,
      ...(o.completion === undefined ? {} : { completion: o.completion }),
      ...o.extraction,
    });
  }

  vision(): ExtractionStrategy {
    return new VisionStrategy({ ...this.#shared, ...this.#options.vision });
  }

  classifier(): Classifier {
    return new LlmClassifier({ ...this.#shared, ...this.#options.classifier });
  }

  layout(): LayoutAnalyzer {
    return new LlmLayoutAnalyzer({ ...this.#shared, ...this.#options.layout });
  }

  /**
   * A splitter for `Process`. Text-based by default, because it needs no rasterizer;
   * `{ splitter: { mode: "image" } }` reads the pages as pictures instead, which is
   * what a scanned bundle with no text layer needs.
   */
  splitter(): Splitter {
    const { mode, ...rest } = this.#options.splitter ?? {};
    const options = { ...this.#shared, ...rest };
    return mode === "image" ? new ImageSplitter(options) : new TextSplitter(options);
  }
}

/** Factory form, for callers who would rather not write `new`. */
export function model(languageModel: LanguageModel, options?: LlmOptions): LLM {
  return new LLM(languageModel, options);
}
