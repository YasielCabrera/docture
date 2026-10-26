/**
 * `createLlmExtractor` — the terse wiring for the common case.
 *
 * `createExtractor` in core takes strategies, not a model: a model belongs to the
 * strategy that calls it, which is what keeps core free of the AI SDK at runtime and
 * lets a deterministic-only pipeline ship without it.
 *
 * That trade costs one line of ceremony for the very common "just use a model" case,
 * so this package — which owns the model concept — pays it back:
 *
 * ```ts
 * const extractor = createLlmExtractor({
 *   loaders: [new DocumentLoaderPdfJs()],
 *   model: openai("gpt-5"),
 * });
 * ```
 *
 * Anything more specific (two models, a deterministic parser first, a custom
 * strategy) goes through `createExtractor` with an explicit `strategies` array.
 *
 * The fluent form says the same thing and is usually clearer, since each line is one
 * decision — reach for whichever reads better at the call site:
 *
 * ```ts
 * new Extractor()
 *   .loadDocumentLoader(new DocumentLoaderPdfJs())
 *   .loadLlm(new LLM(openai("gpt-5")), { vision: true });
 * ```
 */

import {
  createExtractor,
  type CompletionStrategy,
  type Extractor,
  type ExtractorOptions,
} from "../core/index.js";
import type { LanguageModel } from "ai";
import { llm, type LlmStrategyOptions } from "./strategy.js";
import { llmClassifier } from "./classifier.js";
import { vision, type VisionStrategyOptions } from "./vision.js";

export interface LlmExtractorOptions extends Omit<ExtractorOptions, "strategies"> {
  /** Any AI SDK language model. */
  readonly model: LanguageModel;
  /**
   * Also register a vision strategy, for documents with no text layer.
   * `true` uses defaults; pass an object to configure. Requires a loader that can
   * render pages — see `withRasterizer`.
   */
  readonly vision?: boolean | Omit<VisionStrategyOptions, "model">;
  /**
   * Also register an `LlmClassifier`, so `classifications` are decided by the model.
   * Named to avoid colliding with core's `classify`, which tunes how several
   * classifiers' verdicts are reconciled.
   */
  readonly classifyWithModel?: boolean;
  readonly completion?: CompletionStrategy;
  /** Everything else `LlmStrategy` accepts. */
  readonly llm?: Omit<LlmStrategyOptions, "model" | "completion">;
  /**
   * Deterministic strategies to try BEFORE the model. Order matters and these come
   * first, because a parser that works costs nothing and a model always costs
   * something.
   */
  readonly before?: ExtractorOptions["strategies"];
}

export function createLlmExtractor(options: LlmExtractorOptions): Extractor {
  const {
    model,
    vision: visionOption,
    classifyWithModel,
    completion,
    llm: llmOptions,
    before,
    classifiers,
    ...rest
  } = options;

  const shared = {
    ...(llmOptions?.cache === undefined ? {} : { cache: llmOptions.cache }),
    ...(llmOptions?.pricing === undefined ? {} : { pricing: llmOptions.pricing }),
    ...(llmOptions?.temperature === undefined ? {} : { temperature: llmOptions.temperature }),
    ...(llmOptions?.maxRetries === undefined ? {} : { maxRetries: llmOptions.maxRetries }),
    ...(llmOptions?.instructions === undefined ? {} : { instructions: llmOptions.instructions }),
  };

  const strategies = [
    ...(before ?? []),
    llm({
      model,
      ...llmOptions,
      ...(completion === undefined ? {} : { completion }),
    }),
    ...(visionOption === undefined || visionOption === false
      ? []
      : [vision({ model, ...shared, ...(visionOption === true ? {} : visionOption) })]),
  ];

  return createExtractor({
    ...rest,
    strategies,
    ...(classifyWithModel === true
      ? { classifiers: [...(classifiers ?? []), llmClassifier({ model, ...shared })] }
      : classifiers === undefined
        ? {}
        : { classifiers }),
  });
}
