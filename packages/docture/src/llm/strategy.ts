/**
 * `LlmStrategy` — extract a schema from a document's text with any AI SDK model.
 *
 * The model is the AI SDK's own `LanguageModel`. That is the whole integration:
 *
 * ```ts
 * llm({ model: openai("gpt-5") })            // a provider instance
 * llm({ model: anthropic("claude-opus-5") }) // a different provider
 * llm({ model: "openai/gpt-5" })             // a gateway model string
 * ```
 *
 * No model wrapper of our own, no provider registry to keep current, and the schema
 * goes to `generateText` in the caller's original form — Zod stays Zod, so
 * refinements and descriptions reach the provider intact instead of surviving a
 * round trip through JSON Schema.
 */

import { generateText, Output, jsonSchema, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  sumUsage,
  mapWithConcurrency,
  ModelOutputError,
  type ClassificationNeed,
  type CompletionStrategy,
  type ExtractionStrategy,
  type StrategyContext,
  type StrategyOutcome,
  type Usage,
} from "../core/index.js";
import { cacheKey, storedUsage, type LlmCache } from "./cache.js";
import { mergePartials } from "./merge.js";
import { chunkByBudget, chunkByPage, buildPrompt, type Chunk } from "./prompt.js";
import { toUsage, type PricingTable } from "./pricing.js";
import { relaxJsonSchema } from "./relax.js";
import { modelOutputError, withCompletedUsage } from "./failure.js";
import { modelIdOf, providerOf } from "./model-id.js";

export interface LlmStrategyOptions {
  /** Any AI SDK language model: a provider instance or a gateway model string. */
  readonly model: LanguageModel;
  /** Strategy id. Defaults to `"llm"`; change it to register two models at once. */
  readonly name?: string;
  /** Default `"forbidden"` — one request, which is what most documents need. */
  readonly completion?: CompletionStrategy;
  /** Character budget per request under `concatenate`. Default 24000 (~6k tokens). */
  readonly maxCharsPerRequest?: number;
  /** Replaces the default system prompt. */
  readonly system?: string;
  /** Appended to the system prompt — the usual place for domain guidance. */
  readonly instructions?: string;
  /** Extra prompt notes per classification name. */
  readonly hints?: Readonly<Record<string, string>>;
  readonly cache?: LlmCache;
  /** USD per million tokens, by model id. Without it, `costUsd` stays undefined. */
  readonly pricing?: PricingTable;
  /** Default 0 — extraction should be reproducible. */
  readonly temperature?: number;
  /** Provider-specific request settings. Included in the response cache key. */
  readonly providerOptions?: ProviderOptions;
  /** Passed to the AI SDK. Default 2. */
  readonly maxRetries?: number;
  /** Requests in flight at once. Positive integer. Default 4. */
  readonly concurrency?: number;
  readonly needsClassification?: ClassificationNeed;
}

export class LlmStrategy implements ExtractionStrategy {
  readonly name: string;
  /** Text in, so a text layer is the requirement. For scans, use `VisionStrategy`. */
  readonly requires = ["TEXT_LAYER"] as const;
  readonly needsClassification: ClassificationNeed;

  constructor(private readonly options: LlmStrategyOptions) {
    if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency < 1)) {
      throw new RangeError("concurrency must be a positive integer");
    }
    this.name = options.name ?? "llm";
    // "hint" by default: a classification improves the prompt when one exists, but
    // this strategy reads an unrecognised document perfectly well without one — that
    // is the case a model is best at.
    this.needsClassification = options.needsClassification ?? "hint";
  }

  private chunks(ctx: StrategyContext): Chunk[] {
    const completion = this.options.completion ?? "forbidden";
    switch (completion) {
      case "paginate":
        return chunkByPage(ctx.document);
      case "concatenate":
        return chunkByBudget(ctx.document, this.options.maxCharsPerRequest ?? 24_000);
      case "forbidden":
        return [
          {
            text: ctx.document.text,
            pages: ctx.document.pages.map((p) => p.pageNumber),
          },
        ];
    }
  }

  async extract(ctx: StrategyContext): Promise<StrategyOutcome> {
    ctx.signal.throwIfAborted();

    const modelId = modelIdOf(this.options.model);
    const chunks = this.chunks(ctx);
    if (chunks.length === 0) {
      throw new Error("the document has no text to send to a model");
    }

    const hint = [
      ctx.hints,
      ctx.classification === undefined ? undefined : this.options.hints?.[ctx.classification.name],
    ].filter((value): value is string => value !== undefined).join("\n") || undefined;

    /**
     * A fragment cannot satisfy a whole-document schema, so multi-request runs send a
     * `required`-free copy and let the pipeline validate the MERGED result strictly.
     * A single request uses the caller's schema untouched, which keeps Zod
     * refinements and provider-native handling intact in the common case.
     */
    const requestSchema =
      chunks.length > 1
        ? jsonSchema(relaxJsonSchema(ctx.schema.jsonSchema) as Record<string, never>)
        : ctx.schema.flexible;

    const startedAt = Date.now();
    const usages: Partial<Usage>[] = [];

    const parts = await mapWithConcurrency(chunks, this.options.concurrency ?? 4, async (chunk, index, signal) => {
      signal.throwIfAborted();

      const { system, prompt } = buildPrompt(chunk.text, {
        ...(this.options.system === undefined ? {} : { system: this.options.system }),
        ...(this.options.instructions === undefined
          ? {}
          : { instructions: this.options.instructions }),
        ...(ctx.classification === undefined ? {} : { classification: ctx.classification }),
        ...(hint === undefined ? {} : { hints: hint }),
      });

      const key = cacheKey({
        provider: providerOf(this.options.model),
        ...(this.options.providerOptions === undefined ? {} : { providerOptions: this.options.providerOptions }),
        temperature: this.options.temperature,
        modelId,
        system,
        prompt,
        jsonSchema: ctx.schema.jsonSchema,
        // A relaxed request and a strict one can produce different answers for the
        // same text; they must not share a cache entry.
        variant: chunks.length > 1 ? "relaxed" : "strict",
      });
      const cached = await this.options.cache?.get(key);

      if (cached !== undefined) {
        // A cache hit costs nothing, so it contributes tokens but no money.
        usages[index] = toUsage(cached.usage, 0);
        return cached.data;
      }

      signal.throwIfAborted();
      const requestStarted = Date.now();
      const response = await generateText({
        model: this.options.model,
        output: Output.object({ schema: requestSchema }),
        system,
        prompt,
        temperature: this.options.temperature ?? 0,
        maxRetries: this.options.maxRetries ?? 2,
        abortSignal: signal,
        ...(this.options.providerOptions === undefined ? {} : { providerOptions: this.options.providerOptions }),
      }).then((response) => ({ output: response.output, usage: response.usage })).catch((error: unknown) => {
        const failure = modelOutputError(error, {
          modelId,
          pricing: this.options.pricing,
          wallMs: Date.now() - startedAt,
        });
        if (failure instanceof ModelOutputError && failure.usage !== undefined) usages[index] = failure.usage;
        throw failure;
      });

      usages[index] = toUsage(response.usage, Date.now() - requestStarted, modelId, this.options.pricing);

      await this.options.cache?.set(key, {
        data: response.output,
        usage: storedUsage(response.usage),
      });

      ctx.logger.debug("llm chunk extracted", {
        pages: chunk.pages.length,
        inputTokens: response.usage.inputTokens ?? 0,
      });
      return response.output;
    }, ctx.signal).catch((error: unknown) => {
      throw withCompletedUsage(error, usages, Date.now() - startedAt, ctx.reportFailureUsage);
    });

    return {
      // One chunk merges to itself, so `forbidden` pays nothing for this.
      data: mergePartials(parts),
      usage: sumUsage(usages, Date.now() - startedAt),
    };
  }
}

/** Functional form. `llm({ model })` reads better in a `strategies` array. */
export function llm(options: LlmStrategyOptions): ExtractionStrategy {
  return new LlmStrategy(options);
}
