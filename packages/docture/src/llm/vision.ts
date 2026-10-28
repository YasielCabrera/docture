import { jsonSchema, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  sumUsage,
  mapWithConcurrency,
  ModelOutputError,
  type ClassificationNeed,
  type ExtractionStrategy,
  type LoadedPage,
  type RasterFormat,
  type RepairInput,
  type StrategyContext,
  type StrategyOutcome,
  type Usage,
} from "../core/index.js";
import { cacheKey, fingerprint, type ContentPart, type LlmCache } from "./cache.js";
import { mergePartialsWithDiagnostics } from "./merge.js";
import { buildPrompt, type PromptParts } from "./prompt.js";
import { modelIdOf, providerOf } from "./model-id.js";
import type { PricingTable } from "./pricing.js";
import { relaxJsonSchema } from "./relax.js";
import { withCompletedUsage } from "./failure.js";
import { repairFingerprint, repairMessages } from "./repair.js";
import { requestObject, type ObjectRequest, type ObjectResponse } from "./request.js";
import { callTelemetry, type LlmTelemetryOptions, type TelemetryScope } from "./telemetry.js";

export type { LlmTelemetryOptions } from "./telemetry.js";

export interface VisionStrategyOptions {
  readonly model: LanguageModel;
  readonly name?: string;
  /** Render resolution. 200 is usually enough for a model; OCR wants 300. */
  readonly dpi?: number;
  /** Cap the long edge in pixels. Default 1568. */
  readonly maxEdge?: number;
  readonly format?: RasterFormat;
  /** Stop after this many pages. */
  readonly maxPages?: number;
  /**
   * `together` sends consecutive groups of up to pagesPerRequest pages.
   * `perPage` sends one request each and merges.
   */
  readonly pageMode?: "together" | "perPage";
  /** Maximum pages per together request. Positive integer. Default 20. */
  readonly pagesPerRequest?: number;
  readonly system?: string;
  readonly instructions?: string;
  readonly hints?: Readonly<Record<string, string>>;
  readonly cache?: LlmCache;
  readonly pricing?: PricingTable;
  readonly temperature?: number;
  /** Provider-specific request settings. Included in the response cache key. */
  readonly providerOptions?: ProviderOptions;
  readonly maxRetries?: number;
  /** Requests in flight at once. Positive integer. Default 4. */
  readonly concurrency?: number;
  readonly needsClassification?: ClassificationNeed;
  /** AI SDK telemetry. Inputs and outputs are not recorded unless enabled here. */
  readonly telemetry?: LlmTelemetryOptions;
}

const MEDIA_TYPES: Readonly<Record<RasterFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
};

/**
 * Extract structured values from renderable page images.
 *
 * @remarks VisionStrategyOptions requires a model. Defaults are maxEdge 1568, pagesPerRequest 20 and concurrency 4. Provider options and render settings are part of cache identity.
 * @throws MODEL_OUTPUT_FAILED for schema-invalid model responses. Invalid concurrency or image-group limits throw RangeError.
 * @example
 * ```ts
 * import { VisionStrategy } from "docture/llm/vision";
 * const strategy = new VisionStrategy({ model: "openai/gpt-5", maxEdge: 1568 });
 * ```
 */
export class VisionStrategy implements ExtractionStrategy {
  readonly name: string;
  readonly requires = ["RENDERABLE_PAGES"] as const;
  readonly needsClassification: ClassificationNeed;

  constructor(private readonly options: VisionStrategyOptions) {
    if (options.pagesPerRequest !== undefined &&
        (!Number.isInteger(options.pagesPerRequest) || options.pagesPerRequest < 1)) {
      throw new RangeError("pagesPerRequest must be a positive integer");
    }
    if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency < 1)) {
      throw new RangeError("concurrency must be a positive integer");
    }
    this.name = options.name ?? "vision";
    this.needsClassification = options.needsClassification ?? "hint";
  }

  private async render(pages: readonly LoadedPage[]): Promise<Uint8Array[]> {
    const format = this.options.format ?? "png";
    const rasterOptions = {
      dpi: this.options.dpi ?? 200,
      format,
      maxEdge: this.options.maxEdge ?? 1568,
    };

    const images: Uint8Array[] = [];
    for (const page of pages) {
      if (page.image === undefined) {
        throw new Error(
          `page ${page.pageNumber} cannot be rendered — compose the loader with a rasterizer`,
        );
      }
      images.push(await page.image(rasterOptions));
    }
    return images;
  }

  private prompt(ctx: StrategyContext): PromptParts {
    const hint = [
      ctx.hints,
      ctx.classification === undefined ? undefined : this.options.hints?.[ctx.classification.name],
    ].filter((value): value is string => value !== undefined).join("\n") || undefined;
    return buildPrompt("(the document is supplied as page images below)", {
      ...(this.options.system === undefined ? {} : { system: this.options.system }),
      ...(this.options.instructions === undefined ? {} : { instructions: this.options.instructions }),
      ...(ctx.classification === undefined ? {} : { classification: ctx.classification }),
      ...(hint === undefined ? {} : { hints: hint }),
    });
  }

  private groups(ctx: StrategyContext): LoadedPage[][] {
    const pages = ctx.document.pages.slice(0, this.options.maxPages ?? ctx.document.pages.length);
    const groupSize = this.options.pageMode === "perPage" ? 1 : this.options.pagesPerRequest ?? 20;
    return Array.from({ length: Math.ceil(pages.length / groupSize) }, (_, index) =>
      pages.slice(index * groupSize, (index + 1) * groupSize));
  }

  private async content(prompt: string, group: readonly LoadedPage[]): Promise<ContentPart[]> {
    const mediaType = MEDIA_TYPES[this.options.format ?? "png"];
    const images = await this.render(group);
    return [
      { type: "text", text: prompt },
      ...images.map((data) => ({ type: "file" as const, data, mediaType })),
    ];
  }

  private request(
    ctx: StrategyContext,
    request: Pick<ObjectRequest, "schema" | "system" | "input" | "signal" | "startedAt">,
    keyPrompt: string,
    variant: string,
    scope: Omit<TelemetryScope, "component" | "document">,
  ): Promise<ObjectResponse> {
    const modelId = modelIdOf(this.options.model);
    const format = this.options.format ?? "png";
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
        prompt: keyPrompt,
        jsonSchema: ctx.schema.jsonSchema,
        variant:
          `vision:${format}:${this.options.dpi ?? 200}:${this.options.maxEdge ?? 1568}:` +
          `${this.options.pagesPerRequest ?? 20}:${variant}`,
      }),
      temperature: this.options.temperature,
      maxRetries: this.options.maxRetries,
      providerOptions: this.options.providerOptions,
      pricing: this.options.pricing,
    });
  }

  async extract(ctx: StrategyContext): Promise<StrategyOutcome> {
    ctx.signal.throwIfAborted();

    const groups = this.groups(ctx);
    if (groups.length === 0) throw new Error("the document has no pages to render");
    const { system, prompt } = this.prompt(ctx);

    // Same reason as LlmStrategy: a single page cannot satisfy a whole-document
    // schema, so per-page requests get a `required`-free copy and the pipeline
    // validates the merged result. See relax.ts.
    const requestSchema =
      groups.length > 1
        ? jsonSchema(relaxJsonSchema(ctx.schema.jsonSchema) as Record<string, never>)
        : ctx.schema.flexible;

    const startedAt = Date.now();
    const usages: Partial<Usage>[] = [];

    const parts = await mapWithConcurrency(groups, this.options.concurrency ?? 4, async (group, index, signal) => {
      signal.throwIfAborted();
      const content = await this.content(prompt, group);
      // The page numbers are part of the key: the same prompt over page 2 is a
      // different request from the same prompt over page 1.
      const response = await this.request(ctx, {
        schema: requestSchema, system, input: { messages: [{ role: "user", content }] }, signal, startedAt,
      }, fingerprint(content), `${groups.length > 1 ? "relaxed" : "strict"}:${group.map((p) => p.pageNumber).join(",")}`, {
        stage: "vision", pages: group.map((p) => p.pageNumber), chunk: index,
      })
        .catch((error: unknown) => {
          if (error instanceof ModelOutputError && error.usage !== undefined) usages[index] = error.usage;
          throw error;
        });
      usages[index] = response.usage;
      return response.data;
    }, ctx.signal).catch((error: unknown) => {
      throw withCompletedUsage(error, usages, Date.now() - startedAt, ctx.reportFailureUsage, { wholeAnswer: groups.length === 1 });
    });

    const merged = mergePartialsWithDiagnostics(parts.map((data, index) => ({
      data, pages: (groups[index] ?? []).map((page) => page.pageNumber),
    })));
    return {
      data: merged.data,
      usage: sumUsage(usages, Date.now() - startedAt),
      ...(merged.conflicts.length === 0 ? {} : { conflicts: merged.conflicts }),
    };
  }

  /** Re-sends a single group's images with the answer and its issues; a merged answer goes alone. */
  async repair(ctx: StrategyContext, previous: RepairInput): Promise<StrategyOutcome> {
    ctx.signal.throwIfAborted();
    const groups = this.groups(ctx);
    const only = groups.length === 1 ? groups[0] : undefined;
    const { system, prompt } = this.prompt(ctx);
    const messages = repairMessages(only === undefined ? undefined : await this.content(prompt, only), previous);
    const response = await this.request(ctx, {
      schema: ctx.schema.flexible, system, input: { messages }, signal: ctx.signal, startedAt: Date.now(),
    }, repairFingerprint(messages), "repair", {
      stage: "repair", pages: (only ?? groups.flat()).map((p) => p.pageNumber),
    });
    return { data: response.data, usage: response.usage };
  }
}

/** Functional form. */
export function vision(options: VisionStrategyOptions): ExtractionStrategy {
  return new VisionStrategy(options);
}
