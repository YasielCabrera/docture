/**
 * @docture/llm — structured extraction through any AI SDK model.
 *
 * The model is the AI SDK's `LanguageModel`: a provider instance
 * (`openai("gpt-5")`), a gateway model string (`"openai/gpt-5"`), or your own
 * provider. `ai` is a peer dependency, so there is exactly one copy of those types
 * in the tree and the model you construct is the model that runs.
 */

/**
 * `LLM` — a model, and everything it can be turned into. This is what
 * `extractor.loadLlm(...)` takes: core cannot accept a `LanguageModel` directly
 * without depending on the AI SDK, so it accepts a `ModelBackend`, and this is one.
 */
export { LLM, model } from "./llm.js";
export type { LlmOptions } from "./llm.js";

export { LlmStrategy, llm, modelIdOf } from "./strategy.js";
export type { LlmStrategyOptions } from "./strategy.js";

/**
 * Splitting a bundle into its documents, for `Process`. `TextSplitter` reads the
 * pages; `ImageSplitter` looks at them, and needs a loader that can render.
 */
export { ImageSplitter, TextSplitter, imageSplitter, textSplitter } from "./split.js";
export type { SplitterOptions } from "./split.js";

/**
 * NOTE: `CompletionStrategy` is deliberately NOT re-exported here. It is core's
 * vocabulary, and re-exporting it would make `docture`'s `export *` from both
 * packages ambiguous — which ES modules resolve by silently dropping the name.
 * Import it from `@docture/core` or from `docture`.
 */

export { VisionStrategy, vision } from "./vision.js";
export type { VisionStrategyOptions } from "./vision.js";

export { LlmClassifier, llmClassifier } from "./classifier.js";
export type { LlmClassifierOptions } from "./classifier.js";

export { createLlmExtractor } from "./extractor.js";
export type { LlmExtractorOptions } from "./extractor.js";

// Prompting — exported so a caller can build on the defaults rather than replace them.
export { DEFAULT_SYSTEM_PROMPT, buildPrompt, chunkByBudget, chunkByPage, estimateTokens } from "./prompt.js";
export type { BuildPromptOptions, Chunk, PromptParts } from "./prompt.js";

// Response caching — an eval re-scoring a corpus should not pay twice.
export { cacheKey, fileCache, memoryCache } from "./cache.js";
export type { CacheKeyParts, CachedResponse, LlmCache } from "./cache.js";

// Cost accounting. Without a pricing table, `costUsd` is honestly absent.
export { lookupPricing, toUsage } from "./pricing.js";
export type { ModelPricing, PricingTable, RawUsage } from "./pricing.js";

/** How partial extractions from `paginate`/`concatenate` are reassembled. */
export { mergePartials } from "./merge.js";

/**
 * Strip `required` from a JSON Schema. Exported because a custom multi-request
 * strategy needs the same trick: a document fragment cannot satisfy a whole-document
 * schema, so requests over fragments must be relaxed and only the merge validated.
 */
export { relaxJsonSchema } from "./relax.js";
export type { JsonSchemaLike } from "./relax.js";
