/**
 * `VisionStrategy` — extract from page IMAGES rather than page text.
 *
 * This is what reads a scan, and it is why no local VLM sidecar is needed: any
 * vision-capable AI SDK model does the job, chosen by the caller.
 *
 * It requires `RENDERABLE_PAGES`, so it is only ever a candidate when the loader can
 * actually produce images — compose one with `withRasterizer(loader, rasterizer)`.
 */

import { generateObject, jsonSchema, type LanguageModel } from "ai";
import {
  type ClassificationNeed,
  type ExtractionStrategy,
  type LoadedPage,
  type RasterFormat,
  type StrategyContext,
  type StrategyOutcome,
  type Usage,
} from "@docture/core";
import { cacheKey, type LlmCache } from "./cache.js";
import { mergePartials } from "./merge.js";
import { buildPrompt } from "./prompt.js";
import { modelIdOf } from "./strategy.js";
import { toUsage, type PricingTable } from "./pricing.js";
import { relaxJsonSchema } from "./relax.js";

export interface VisionStrategyOptions {
  readonly model: LanguageModel;
  readonly name?: string;
  /** Render resolution. 200 is usually enough for a model; OCR wants 300. */
  readonly dpi?: number;
  /** Cap the long edge in pixels. Keeps a model's image budget predictable. */
  readonly maxEdge?: number;
  readonly format?: RasterFormat;
  /** Stop after this many pages. */
  readonly maxPages?: number;
  /**
   * `together` sends every page in one request, so the model sees the whole
   * document and can resolve a total on page 3 against rows on page 1.
   * `perPage` sends one request each and merges — cheaper per request, and the only
   * option when the document exceeds the model's image limit.
   */
  readonly pageMode?: "together" | "perPage";
  readonly system?: string;
  readonly instructions?: string;
  readonly hints?: Readonly<Record<string, string>>;
  readonly cache?: LlmCache;
  readonly pricing?: PricingTable;
  readonly temperature?: number;
  readonly maxRetries?: number;
  readonly needsClassification?: ClassificationNeed;
}

const MEDIA_TYPES: Readonly<Record<RasterFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
};

function sumUsage(parts: readonly Partial<Usage>[], wallMs: number): Partial<Usage> {
  const costs = parts.map((p) => p.costUsd).filter((c): c is number => c !== undefined);
  return {
    inputTokens: parts.reduce((sum, p) => sum + (p.inputTokens ?? 0), 0),
    outputTokens: parts.reduce((sum, p) => sum + (p.outputTokens ?? 0), 0),
    totalTokens: parts.reduce((sum, p) => sum + (p.totalTokens ?? 0), 0),
    wallMs,
    ...(costs.length === 0 ? {} : { costUsd: costs.reduce((sum, c) => sum + c, 0) }),
  };
}

export class VisionStrategy implements ExtractionStrategy {
  readonly name: string;
  readonly requires = ["RENDERABLE_PAGES"] as const;
  readonly needsClassification: ClassificationNeed;

  constructor(private readonly options: VisionStrategyOptions) {
    this.name = options.name ?? "vision";
    this.needsClassification = options.needsClassification ?? "hint";
  }

  private async render(pages: readonly LoadedPage[]): Promise<Uint8Array[]> {
    const format = this.options.format ?? "png";
    const rasterOptions = {
      dpi: this.options.dpi ?? 200,
      format,
      ...(this.options.maxEdge === undefined ? {} : { maxEdge: this.options.maxEdge }),
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

    const hint =
      ctx.classification === undefined ? undefined : this.options.hints?.[ctx.classification.name];

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

    const groups =
      (this.options.pageMode ?? "together") === "together" ? [pages] : pages.map((page) => [page]);

    // Same reason as LlmStrategy: a single page cannot satisfy a whole-document
    // schema, so per-page requests get a `required`-free copy and the pipeline
    // validates the merged result. See relax.ts.
    const requestSchema =
      groups.length > 1
        ? jsonSchema(relaxJsonSchema(ctx.schema.jsonSchema) as Record<string, never>)
        : ctx.schema.flexible;

    const startedAt = Date.now();
    const parts: unknown[] = [];
    const usages: Partial<Usage>[] = [];

    for (const group of groups) {
      ctx.signal.throwIfAborted();
      const images = await this.render(group);

      // The page numbers are part of the key: the same prompt over page 2 is a
      // different request from the same prompt over page 1.
      const key = cacheKey({
        modelId,
        system,
        prompt,
        jsonSchema: ctx.schema.jsonSchema,
        variant:
          `vision:${format}:${this.options.dpi ?? 200}:` +
          `${groups.length > 1 ? "relaxed" : "strict"}:` +
          `${group.map((p) => p.pageNumber).join(",")}`,
      });

      const cached = await this.options.cache?.get(key);
      if (cached !== undefined) {
        parts.push(cached.data);
        usages.push({
          inputTokens: cached.usage.inputTokens ?? 0,
          outputTokens: cached.usage.outputTokens ?? 0,
          totalTokens: cached.usage.totalTokens ?? 0,
        });
        continue;
      }

      const requestStarted = Date.now();
      const response = await generateObject({
        model: this.options.model,
        schema: requestSchema,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              // A `file` part, not the deprecated `image` part. Same bytes; this is
              // the shape the AI SDK carries forward.
              ...images.map((image) => ({
                type: "file" as const,
                data: image,
                mediaType,
              })),
            ],
          },
        ],
        temperature: this.options.temperature ?? 0,
        maxRetries: this.options.maxRetries ?? 2,
        abortSignal: ctx.signal,
      });

      parts.push(response.object);
      usages.push(
        toUsage(response.usage, Date.now() - requestStarted, modelId, this.options.pricing),
      );

      await this.options.cache?.set(key, {
        data: response.object,
        usage: {
          inputTokens: response.usage.inputTokens ?? 0,
          outputTokens: response.usage.outputTokens ?? 0,
          totalTokens: response.usage.totalTokens ?? 0,
        },
      });
    }

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
