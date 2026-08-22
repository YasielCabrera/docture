/**
 * `TextSplitter` and `ImageSplitter` — finding where a bundle divides.
 *
 * Both answer the same question and differ only in what they look at: page text, or
 * a picture of the page. That is why they are one file — the prompt, the schemas and
 * the name-reconciliation are shared, and only "what goes in the message" differs.
 * Two files would have been two prompts that drifted.
 *
 * ```ts
 * new Process()
 *   .loadDocumentLoader(withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer()))
 *   .loadSplitter(new ImageSplitter({ model: openai("gpt-5") }))
 *   .loadExtractor(extractor)
 *   .loadFile("batch.pdf")
 *   .split([invoice, licence], SplittingStrategy.LAZY)
 *   .extract();
 * ```
 */

import { createHash } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod/v4";
import {
  UNCLASSIFIED,
  type Classification,
  type DocGroups,
  type LoadedPage,
  type RasterFormat,
  type SplitContext,
  type SplitVerdict,
  type Splitter,
} from "@docture/core";
import { cacheKey, type LlmCache } from "./cache.js";
import { toUsage, type PricingTable } from "./pricing.js";
import { modelIdOf } from "./strategy.js";

export interface SplitterOptions {
  readonly model: LanguageModel;
  /** Splitter id. Defaults to the class name. */
  readonly name?: string;
  /** Characters of each page to send. Default 1200 — a heading is near the top. */
  readonly excerptChars?: number;
  /** Appended to the system prompt. */
  readonly instructions?: string;
  readonly cache?: LlmCache;
  readonly pricing?: PricingTable;
  readonly temperature?: number;
  readonly maxRetries?: number;
  /** Render resolution for `ImageSplitter`. Default 120 — a layout, not a read. */
  readonly dpi?: number;
  readonly maxEdge?: number;
  readonly format?: RasterFormat;
  /** Cap the pages an EAGER split sends in one request. Default 40. */
  readonly maxEagerPages?: number;
}

/**
 * What goes into one user message.
 *
 * A `file` part, not the deprecated `image` part — same bytes, and the shape the AI
 * SDK carries forward. `VisionStrategy` sends pages the same way.
 */
type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly data: Uint8Array; readonly mediaType: string };

/**
 * A stable digest of the message content, for the cache key.
 *
 * Image bytes are hashed rather than embedded: the key must change when the picture
 * does, and a base64 page at 120 dpi is a bad thing to keep in memory just to name a
 * cache entry.
 */
function fingerprint(content: readonly ContentPart[]): string {
  const hash = createHash("sha256");
  for (const part of content) {
    if (part.type === "text") {
      hash.update("t:");
      hash.update(part.text);
    } else {
      hash.update("f:");
      hash.update(part.mediaType);
      hash.update(part.data);
    }
  }
  return hash.digest("hex");
}

const seamSchema = z.object({
  belongsToSameDocument: z
    .boolean()
    .describe("True when the second page continues the first page's document."),
  classificationPage1: z.string().describe("The document type of the first page."),
  classificationPage2: z.string().describe("The document type of the second page."),
  confidence: z.number().min(0).max(1).describe("How certain you are, 0 to 1."),
});

const eagerSchema = z.object({
  documents: z
    .array(
      z.object({
        pages: z
          .array(z.number().int().min(1))
          .describe("The 1-based page numbers of this document, ascending."),
        classification: z.string().describe("The document type, or UNKNOWN."),
        confidence: z.number().min(0).max(1),
      }),
    )
    .describe("Every document in the bundle, in page order, covering every page once."),
});

const SYSTEM = [
  "You are given the pages of a scanned batch that may contain several unrelated documents.",
  "Decide where one document ends and the next begins.",
  "A new document starts at a page that opens with its own header, addressee or title —",
  "not at a page that merely continues a table or a paragraph from the page before.",
  "Judge only on what you can see. Do not guess to be helpful.",
].join(" ");

function catalogue(classifications: readonly Classification[]): string {
  return classifications.map((c) => `- ${c.name}: ${c.description}`).join("\n");
}

/**
 * Map a model's answer back onto a real classification name.
 *
 * Case-insensitive because a model will happily return "Invoice" for a candidate
 * named "invoice", and failing the whole split over capitalisation would be absurd.
 * Anything it invents becomes UNKNOWN, which `Process` surfaces rather than swallows.
 */
function reconcile(name: string, classifications: readonly Classification[]): string {
  const wanted = name.trim().toLowerCase();
  return classifications.find((c) => c.name.toLowerCase() === wanted)?.name ?? UNCLASSIFIED;
}

abstract class ModelSplitter implements Splitter {
  readonly name: string;
  abstract readonly requires: readonly string[];

  constructor(protected readonly options: SplitterOptions) {
    this.name = options.name ?? this.constructor.name;
  }

  /** What one page contributes to a message. Text or a picture — the whole difference. */
  protected abstract pageContent(page: LoadedPage): Promise<ContentPart>;

  protected system(): string {
    const extra = this.options.instructions;
    return extra === undefined ? SYSTEM : `${SYSTEM}\n\n${extra}`;
  }

  async belongsToSameDocument(
    first: LoadedPage,
    second: LoadedPage,
    ctx: SplitContext,
  ): Promise<SplitVerdict> {
    const content: ContentPart[] = [
      { type: "text", text: `Document types:\n${catalogue(ctx.classifications)}` },
      { type: "text", text: `--- Page ${first.pageNumber} ---` },
      await this.pageContent(first),
      { type: "text", text: `--- Page ${second.pageNumber} ---` },
      await this.pageContent(second),
      { type: "text", text: "Does page two continue page one's document? Classify each page." },
    ];

    const value = await this.#ask(seamSchema, content, "seam", ctx);
    return {
      belongsToSameDocument: value.belongsToSameDocument,
      classificationPage1: reconcile(value.classificationPage1, ctx.classifications),
      classificationPage2: reconcile(value.classificationPage2, ctx.classifications),
      confidence: value.confidence,
    };
  }

  async splitEager(pages: readonly LoadedPage[], ctx: SplitContext): Promise<DocGroups> {
    const limit = this.options.maxEagerPages ?? 40;
    const sent = pages.slice(0, limit);
    if (sent.length < pages.length) {
      // Never truncate silently: a bundle cut short reads exactly like a bundle that
      // was fully considered and simply had nothing after page 40.
      ctx.logger.warn("eager split truncated", {
        sent: String(sent.length),
        total: String(pages.length),
      });
    }

    const content: ContentPart[] = [
      { type: "text", text: `Document types:\n${catalogue(ctx.classifications)}` },
    ];
    for (const page of sent) {
      content.push({ type: "text", text: `--- Page ${page.pageNumber} ---` });
      content.push(await this.pageContent(page));
    }
    content.push({
      type: "text",
      text:
        `List every document in these ${sent.length} pages. ` +
        "Each page must appear in exactly one document, and page numbers must ascend.",
    });

    const value = await this.#ask(eagerSchema, content, "eager", ctx);

    const known = new Set(pages.map((page) => page.pageNumber));
    const groups = value.documents
      .map((document) => ({
        pages: [...new Set(document.pages)].filter((n) => known.has(n)).sort((a, b) => a - b),
        classification: reconcile(document.classification, ctx.classifications),
        confidence: document.confidence,
      }))
      .filter((group) => group.pages.length > 0);

    return this.#coverEveryPage(groups, pages);
  }

  /**
   * Pages the model forgot are appended to the group that owns the page before them.
   *
   * A dropped page is the failure mode that matters here: it disappears from the
   * extraction with nothing in the output to say it ever existed.
   */
  #coverEveryPage(
    groups: { pages: number[]; classification: string; confidence: number }[],
    pages: readonly LoadedPage[],
  ): DocGroups {
    const claimed = new Set(groups.flatMap((group) => group.pages));
    const ordered = [...groups].sort((a, b) => (a.pages[0] ?? 0) - (b.pages[0] ?? 0));

    for (const page of pages) {
      if (claimed.has(page.pageNumber)) continue;
      const owner = [...ordered]
        .reverse()
        .find((group) => (group.pages[0] ?? Infinity) < page.pageNumber);
      if (owner === undefined) {
        ordered.unshift({
          pages: [page.pageNumber],
          classification: UNCLASSIFIED,
          confidence: 0,
        });
      } else {
        owner.pages.push(page.pageNumber);
        owner.pages.sort((a, b) => a - b);
      }
      claimed.add(page.pageNumber);
    }

    return ordered;
  }

  /**
   * One request, cached.
   *
   * The key covers the rendered content, so a re-run over the same bundle costs
   * nothing — which matters most for `LAZY`, where a 60-page scan is 59 requests.
   * Rendering still happens: the image bytes ARE the key, so they have to exist
   * before the cache can be consulted.
   */
  async #ask<T>(
    schema: z.ZodType<T>,
    content: readonly ContentPart[],
    variant: string,
    ctx: SplitContext,
  ): Promise<T> {
    const cache = this.options.cache;
    const key =
      cache === undefined
        ? undefined
        : cacheKey({
            modelId: modelIdOf(this.options.model),
            system: this.system(),
            prompt: fingerprint(content),
            jsonSchema: z.toJSONSchema(schema),
            variant,
          });

    if (cache !== undefined && key !== undefined) {
      const hit = await cache.get(key);
      if (hit !== undefined) return hit.data as T;
    }

    const started = Date.now();
    const result = await generateObject({
      model: this.options.model,
      schema,
      system: this.system(),
      messages: [{ role: "user", content: content as never }],
      temperature: this.options.temperature ?? 0,
      maxRetries: this.options.maxRetries ?? 2,
      abortSignal: ctx.signal,
    });

    ctx.recordUsage?.(
      toUsage(
        result.usage,
        Date.now() - started,
        modelIdOf(this.options.model),
        this.options.pricing,
      ),
    );

    if (cache !== undefined && key !== undefined) {
      await cache.set(key, {
        data: result.object,
        // `LanguageModelUsage` leaves every count optional; `CachedResponse` wants
        // them present-or-absent, not present-and-undefined.
        usage: {
          ...(result.usage.inputTokens === undefined
            ? {}
            : { inputTokens: result.usage.inputTokens }),
          ...(result.usage.outputTokens === undefined
            ? {}
            : { outputTokens: result.usage.outputTokens }),
          ...(result.usage.totalTokens === undefined
            ? {}
            : { totalTokens: result.usage.totalTokens }),
        },
      });
    }
    // `generateObject`'s return type widens to include the array form for a schema
    // it cannot prove is an object. Both schemas here are objects.
    return result.object as T;
  }
}

/** Split by reading the pages. Needs a text layer; costs no rendering. */
export class TextSplitter extends ModelSplitter {
  override readonly requires = ["TEXT_LAYER"] as const;

  protected override async pageContent(
    page: LoadedPage,
  ): Promise<{ type: "text"; text: string }> {
    const chars = this.options.excerptChars ?? 1200;
    const text = page.text.slice(0, chars).trim();
    return { type: "text", text: text === "" ? "(this page has no text)" : text };
  }
}

/** Split by looking at the pages. Needs a loader that can render — `withRasterizer`. */
export class ImageSplitter extends ModelSplitter {
  override readonly requires = ["RENDERABLE_PAGES"] as const;

  protected override async pageContent(
    page: LoadedPage,
  ): Promise<{ type: "file"; data: Uint8Array; mediaType: string }> {
    if (page.image === undefined) {
      throw new TypeError(
        `${this.name} needs page images. Compose the loader with a rasterizer: ` +
          "withRasterizer(loader, rasterizer).",
      );
    }
    const format = this.options.format ?? "png";
    const bytes = await page.image({
      dpi: this.options.dpi ?? 120,
      format,
      ...(this.options.maxEdge === undefined ? {} : { maxEdge: this.options.maxEdge }),
    });
    return {
      type: "file",
      data: bytes,
      mediaType: format === "png" ? "image/png" : "image/jpeg",
    };
  }
}

/** Factory forms, for callers who would rather not write `new`. */
export function textSplitter(options: SplitterOptions): TextSplitter {
  return new TextSplitter(options);
}

export function imageSplitter(options: SplitterOptions): ImageSplitter {
  return new ImageSplitter(options);
}
