import { generateText, Output, jsonSchema, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  sumUsage,
  mapWithConcurrency,
  ModelOutputError,
  type ClassificationNeed,
  type ExtractionStrategy,
  type LoadedPage,
  type RasterFormat,
  type StrategyContext,
  type StrategyOutcome,
  type Usage,
} from "../core/index.js";
import { cacheKey, storedUsage, fingerprint, type ContentPart, type LlmCache } from "./cache.js";
import { mergePartials } from "./merge.js";
import { buildPrompt } from "./prompt.js";
import { modelIdOf, providerOf } from "./model-id.js";
import { toUsage, type PricingTable } from "./pricing.js";
import { relaxJsonSchema } from "./relax.js";
import { modelOutputError, withCompletedUsage } from "./failure.js";

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

  async extract(ctx: StrategyContext): Promise<StrategyOutcome> {
    ctx.signal.throwIfAborted();

    const modelId = modelIdOf(this.options.model);
    const format = this.options.format ?? "png";
    const mediaType = MEDIA_TYPES[format];

    const pages = ctx.document.pages.slice(0, this.options.maxPages ?? ctx.document.pages.length);
    if (pages.length === 0) throw new Error("the document has no pages to render");

    const hint = [
      ctx.hints,
      ctx.classification === undefined ? undefined : this.options.hints?.[ctx.classification.name],
    ].filter((value): value is string => value !== undefined).join("\n") || undefined;

    const { system, prompt } = buildPrompt(
      "(the document is supplied as page images below)",
      {
        ...(this.options.system === undefined ? {} : { system: this.options.system }),
        ...(this.options.instructions === undefined
          ? {}
          : { instructions: this.options.instructions }),
        ...(ctx.classification === undefined ? {} : { classification: ctx.classification }),
        ...(hint === undefined ? {} : { hints: hint }),
      },
    );

    const pagesPerRequest = this.options.pagesPerRequest ?? 20;
    const groupSize = this.options.pageMode === "perPage" ? 1 : pagesPerRequest;
    const groups = Array.from({ length: Math.ceil(pages.length / groupSize) }, (_, index) =>
      pages.slice(index * groupSize, (index + 1) * groupSize));

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
      const images = await this.render(group);

      const content: ContentPart[] = [
        { type: "text", text: prompt },
        ...images.map((data) => ({ type: "file" as const, data, mediaType })),
      ];

      // The page numbers are part of the key: the same prompt over page 2 is a
      // different request from the same prompt over page 1.
      const key = cacheKey({
        provider: providerOf(this.options.model),
        ...(this.options.providerOptions === undefined ? {} : { providerOptions: this.options.providerOptions }),
        temperature: this.options.temperature,
        modelId,
        system,
        prompt: fingerprint(content),
        jsonSchema: ctx.schema.jsonSchema,
        variant:
          `vision:${format}:${this.options.dpi ?? 200}:${this.options.maxEdge ?? 1568}:${pagesPerRequest}:` +
          `${groups.length > 1 ? "relaxed" : "strict"}:` +
          `${group.map((p) => p.pageNumber).join(",")}`,
      });

      const cached = await this.options.cache?.get(key);
      if (cached !== undefined) {
        usages[index] = toUsage(cached.usage, 0);
        return cached.data;
      }

      signal.throwIfAborted();
      const requestStarted = Date.now();
      const response = await generateText({
        model: this.options.model,
        output: Output.object({ schema: requestSchema }),
        system,
        messages: [
          {
            role: "user",
            content,
          },
        ],
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
      return response.output;
    }, ctx.signal).catch((error: unknown) => {
      throw withCompletedUsage(error, usages, Date.now() - startedAt, ctx.reportFailureUsage);
    });

    return {
      data: mergePartials(parts),
      usage: sumUsage(usages, Date.now() - startedAt),
    };
  }
}

/** Functional form. */
export function vision(options: VisionStrategyOptions): ExtractionStrategy {
  return new VisionStrategy(options);
}
