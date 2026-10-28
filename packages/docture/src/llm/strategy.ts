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

import { jsonSchema, type LanguageModel } from "ai";
import { asSchema, type FlexibleSchema, type ProviderOptions } from "@ai-sdk/provider-utils";
import {
  sumUsage,
  mapWithConcurrency,
  ModelOutputError,
  type ClassificationNeed,
  type CompletionStrategy,
  type ExtractionStrategy,
  type LoadedDocument,
  type OutcomeCitation,
  type RepairInput,
  type StrategyContext,
  type StrategyOutcome,
  type Usage,
} from "../core/index.js";
import { analyzeDocument } from "../core/conversion/analyze.js";
import type { EvidenceLine } from "./evidence.js";
import { flattenHeaderRows } from "../core/conversion/tables.js";
import { cacheKey, type LlmCache } from "./cache.js";
import {
  CITED_VARIANT,
  citationRank,
  citedJsonSchema,
  citedPrompt,
  citedSchema,
  inheritCitations,
  rebaseCitations,
  verifyCitations,
  withLineIds,
  type CitedAnswer,
} from "./citations.js";
import { foldParts } from "./fold.js";
import { chunkByBudget, chunkByPage, buildPrompt, type Chunk, type ChunkContext, type PromptParts } from "./prompt.js";
import type { PricingTable } from "./pricing.js";
import { relaxJsonSchema } from "./relax.js";
import { withCompletedUsage } from "./failure.js";
import { repairFingerprint, repairMessages } from "./repair.js";
import { EXTRACTION_CACHE_VERSION, requestObject, untransformed, type ObjectRequest, type ObjectResponse } from "./request.js";
import { callTelemetry, type LlmTelemetryOptions, type TelemetryScope } from "./telemetry.js";
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
  /** AI SDK telemetry. Inputs and outputs are not recorded unless enabled here. */
  readonly telemetry?: LlmTelemetryOptions;
  /**
   * Ask the model which source records show each value, and verify against their
   * text. Default false. Real positioned lines and native element/cell evidence
   * retain their own granularity. Plain text without addressable evidence stays
   * uncited. Cited requests add IDs and a citations list to the model exchange.
   */
  readonly citations?: boolean;
}

interface CitedChunk extends Chunk {
  readonly lines: readonly EvidenceLine[];
}

interface Part {
  readonly data: unknown;
  readonly citations: readonly OutcomeCitation[];
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

  private chunks(ctx: StrategyContext): CitedChunk[] {
    const cited = this.options.citations === true ? withLineIds(ctx.document) : undefined;
    const document = cited?.document ?? ctx.document;
    const completion = this.options.completion ?? "forbidden";
    let chunks: Chunk[];
    switch (completion) {
      case "paginate":
        chunks = chunkByPage(document, tableHeaderContext(ctx.document));
        break;
      case "concatenate":
        chunks = chunkByBudget(document, this.options.maxCharsPerRequest ?? 24_000, tableHeaderContext(ctx.document));
        break;
      case "forbidden":
        chunks = [
          {
            text: document.text,
            pages: document.pages.map((p) => p.pageNumber),
          },
        ];
    }
    return chunks.map((chunk) => ({
      ...chunk,
      lines: cited === undefined ? [] : chunk.pages.flatMap((page) => cited.lines.get(page) ?? []),
    }));
  }

  private prompt(ctx: StrategyContext, text: string): PromptParts {
    const hint = [
      ctx.hints,
      ctx.classification === undefined ? undefined : this.options.hints?.[ctx.classification.name],
    ].filter((value): value is string => value !== undefined).join("\n") || undefined;
    return buildPrompt(text, {
      ...(this.options.system === undefined ? {} : { system: this.options.system }),
      ...(this.options.instructions === undefined ? {} : { instructions: this.options.instructions }),
      ...(ctx.classification === undefined ? {} : { classification: ctx.classification }),
      ...(hint === undefined ? {} : { hints: hint }),
      ...(ctx.examples === undefined ? {} : { examples: ctx.examples }),
    });
  }

  private request(
    ctx: StrategyContext,
    request: Pick<ObjectRequest, "schema" | "system" | "input" | "signal" | "startedAt" | "rawOf">,
    key: { readonly prompt: string; readonly variant: string; readonly jsonSchema: unknown },
    scope: Omit<TelemetryScope, "component" | "document">,
  ): Promise<ObjectResponse> {
    const modelId = modelIdOf(this.options.model);
    return requestObject({
      ...request,
      telemetry: callTelemetry(this.options.telemetry, { ...scope, component: this.name, document: ctx.documentLabel }),
      model: this.options.model,
      modelId,
      cache: this.options.cache,
      key: cacheKey({
        provider: providerOf(this.options.model),
        ...(this.options.providerOptions === undefined ? {} : { providerOptions: this.options.providerOptions }),
        temperature: this.options.temperature,
        modelId,
        system: request.system,
        prompt: key.prompt,
        jsonSchema: key.jsonSchema,
        variant: `${EXTRACTION_CACHE_VERSION}:${key.variant}`,
      }),
      temperature: this.options.temperature,
      maxRetries: this.options.maxRetries,
      providerOptions: this.options.providerOptions,
      pricing: this.options.pricing,
    });
  }

  async extract(ctx: StrategyContext): Promise<StrategyOutcome> {
    ctx.signal.throwIfAborted();

    const chunks = this.chunks(ctx);
    if (chunks.length === 0) {
      throw new Error("the document has no text to send to a model");
    }

    /**
     * A fragment cannot satisfy a whole-document schema, so multi-request runs send a
     * `required`-free copy and let the pipeline validate the MERGED result strictly.
     * A single request uses the caller's schema untouched, which keeps Zod
     * refinements and provider-native handling intact in the common case.
     */
    const single = chunks.length === 1;
    const dataJson = single ? ctx.schema.jsonSchema : relaxJsonSchema(ctx.schema.jsonSchema) as Record<string, unknown>;
    const requestSchema = single ? untransformed(ctx.schema.flexible) : jsonSchema(dataJson as Record<string, never>);
    const cacheVariant = single ? "strict" : "relaxed";
    const cited = chunks.some((chunk) => chunk.lines.length > 0) ? this.cited(ctx, dataJson, single) : undefined;

    const startedAt = Date.now();
    const usages: Partial<Usage>[] = [];

    const parts = await mapWithConcurrency(chunks, this.options.concurrency ?? 4, async (chunk, index, signal): Promise<Part> => {
      signal.throwIfAborted();
      const cites = cited !== undefined && chunk.lines.length > 0;
      const { system, prompt } = cites ? citedPrompt(this.prompt(ctx, chunk.text)) : this.prompt(ctx, chunk.text);
      const response = await this.request(ctx, {
        schema: cites ? cited.schema : requestSchema, system, input: { prompt }, signal, startedAt,
        ...(cites ? { rawOf: rawAnswer } : {}),
      }, {
        prompt,
        variant: cites ? cacheVariant + CITED_VARIANT : cacheVariant,
        jsonSchema: cites ? cited.json : ctx.schema.jsonSchema,
      }, {
        stage: "extract", pages: chunk.pages, chunk: index,
      }).catch((error: unknown) => {
        if (error instanceof ModelOutputError && error.usage !== undefined) usages[index] = error.usage;
        throw error;
      });
      usages[index] = response.usage;
      ctx.logger.debug("llm chunk extracted", {
        pages: chunk.pages.length,
        inputTokens: response.usage.inputTokens ?? 0,
      });
      if (!cites) return { data: response.data, citations: [] };
      const answer = response.data as CitedAnswer;
      return { data: answer.data, citations: verifyCitations(answer.raw.data, answer.raw.citations, chunk.lines) };
    }, ctx.signal).catch((error: unknown) => {
      throw withCompletedUsage(error, usages, Date.now() - startedAt, ctx.reportFailureUsage, { wholeAnswer: single });
    });

    const citations = parts.map((part) => part.citations);
    const merged = foldParts(
      parts.map((part, index) => ({ data: part.data, pages: chunks[index]?.pages ?? [] })),
      this.options.citations === true ? citationRank(citations) : undefined,
    );
    return {
      data: merged.data,
      usage: sumUsage(usages, Date.now() - startedAt),
      ...(merged.conflicts.length === 0 ? {} : { conflicts: merged.conflicts }),
      ...(this.options.citations === true
        ? { citations: single ? citations[0] ?? [] : rebaseCitations(merged.origins, citations) }
        : {}),
    };
  }

  private cited(ctx: StrategyContext, dataJson: Record<string, unknown>, single: boolean): {
    readonly json: Record<string, unknown>;
    readonly schema: FlexibleSchema<CitedAnswer>;
  } {
    const json = citedJsonSchema(dataJson);
    return { json, schema: citedSchema(json, single ? asSchema(untransformed(ctx.schema.flexible)).validate : undefined, single) };
  }

  /** Replays a single request with the answer and its issues; a merged answer goes alone. */
  async repair(ctx: StrategyContext, previous: RepairInput): Promise<StrategyOutcome> {
    ctx.signal.throwIfAborted();
    const chunks = this.chunks(ctx);
    const only = chunks.length === 1 ? chunks[0] : undefined;
    const cited = only !== undefined && only.lines.length > 0 ? this.cited(ctx, ctx.schema.jsonSchema, true) : undefined;
    const parts = this.prompt(ctx, only?.text ?? "");
    const { system, prompt } = cited === undefined ? parts : citedPrompt(parts);
    const messages = repairMessages(only === undefined ? undefined : [{ type: "text", text: prompt }], previous, cited !== undefined);
    const response = await this.request(ctx, {
      schema: cited?.schema ?? untransformed(ctx.schema.flexible), system, input: { messages }, signal: ctx.signal, startedAt: Date.now(),
      ...(cited === undefined ? {} : { rawOf: rawAnswer }),
    }, {
      prompt: repairFingerprint(messages),
      variant: cited === undefined ? "repair" : "repair" + CITED_VARIANT,
      jsonSchema: cited?.json ?? ctx.schema.jsonSchema,
    }, {
      stage: "repair", pages: only?.pages ?? chunks.flatMap((chunk) => chunk.pages),
    });
    if (this.options.citations !== true) return { data: response.data, usage: response.usage };
    if (cited !== undefined) {
      const answer = response.data as CitedAnswer;
      return {
        data: answer.data,
        usage: response.usage,
        citations: verifyCitations(answer.raw.data, answer.raw.citations, only?.lines ?? []),
      };
    }
    const inherited = only === undefined && previous.kind === "data"
      ? inheritCitations(previous.data, response.data, previous.citations ?? [])
      : [];
    return { data: response.data, usage: response.usage, citations: inherited };
  }
}

const TABLE_CONTEXT_END = "(Header repeated for context; not a data row.)";

function tableHeaderContext(document: LoadedDocument): ChunkContext | undefined {
  if (!document.pages.some((page) => (page.lines?.length ?? 0) > 0)) return undefined;
  const blocks = new Map<number, string[]>();
  for (const element of analyzeDocument(document).document.pages.flatMap((page) => page.elements)) {
    if (element.kind !== "table" || element.headerRows === 0) continue;
    const start = element.provenance.pageNumber;
    const header = (flattenHeaderRows(element)[0] ?? []).join(" | ");
    const block = `Table header continued from page ${start}:\n${header}\n${TABLE_CONTEXT_END}`;
    const pages = element.rowProvenance?.slice(element.headerRows).map((segment) => segment.pageNumber) ??
      element.provenance.continuations?.map((segment) => segment.pageNumber) ?? [];
    for (const page of new Set(pages)) {
      if (page > start) blocks.set(page, [...(blocks.get(page) ?? []), block]);
    }
  }
  return blocks.size === 0 ? undefined : (pageNumber) => blocks.get(pageNumber)?.join("\n\n");
}

function rawAnswer(output: unknown): unknown {
  return (output as CitedAnswer).raw;
}

/** Functional form. `llm({ model })` reads better in a `strategies` array. */
export function llm(options: LlmStrategyOptions): ExtractionStrategy & Pick<LlmStrategy, "requires"> {
  return new LlmStrategy(options);
}
