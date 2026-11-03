/** Read rendered pages with a vision model into native layout elements. */

import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
// Loads `ai` before `zod`, so a consumer missing both is told to install `ai` first.
import { requestObject } from "./request.js";
import { z } from "zod/v4";
import {
  inferForm,
  mapWithConcurrency,
  ModelOutputError,
  PageSelectionError,
  sumUsage,
  type DocumentElement,
  type DocumentLoader,
  type LayoutPage,
  type LoadContext,
  type LoadedDocument,
  type LoadedPage,
  type LoaderCapabilities,
  type RasterFormat,
  type RasterPage,
  type Rasterizer,
  type RawDocument,
  type Usage,
} from "../core/index.js";
import { pageImageRenderer } from "../core/contracts/page-images.js";
import { withElementIds } from "../core/conversion/element-ids.js";
import { exportDocument } from "../core/conversion/export.js";
import { requestedPageNumbers } from "../core/pipeline/pages.js";
import { cacheKey, fingerprint, type ContentPart, type LlmCache } from "./cache.js";
import { modelIdOf, providerOf } from "./model-id.js";
import type { PricingTable } from "./pricing.js";
import { callTelemetry, type LlmTelemetryOptions } from "./telemetry.js";

export type { LlmTelemetryOptions } from "./telemetry.js";

export interface LlmOcrLoaderOptions {
  readonly model: LanguageModel;
  /** Renders PDF pages to the images the model reads. */
  readonly rasterizer: Rasterizer;
  readonly name?: string;
  /** Appended to the built-in system prompt. */
  readonly instructions?: string;
  /** Render resolution. Default 200. */
  readonly dpi?: number;
  /** Cap the long edge in pixels. Default 1568. */
  readonly maxEdge?: number;
  /** Default `"png"`. */
  readonly format?: RasterFormat;
  /** Stop after this many pages. */
  readonly maxPages?: number;
  /** Pages read at once. Positive integer. Default 4. */
  readonly concurrency?: number;
  readonly cache?: LlmCache;
  readonly pricing?: PricingTable;
  readonly temperature?: number;
  /** Provider-specific request settings. Included in the response cache key. */
  readonly providerOptions?: ProviderOptions;
  readonly maxRetries?: number;
  /** AI SDK telemetry. Recording defaults to false; integration callbacks still receive prompts and answers. */
  readonly telemetry?: LlmTelemetryOptions;
}

const MEDIA_TYPES: Readonly<Record<RasterFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
};

const ZERO_BOX = { x: 0, y: 0, width: 0, height: 0 } as const;

const text = z.string();
const headingLevel = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);

const elementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), level: headingLevel, text }).strict(),
  z.object({ kind: z.literal("paragraph"), text }).strict(),
  z.object({ kind: z.literal("code"), text }).strict(),
  z.object({
    kind: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(z.object({ marker: z.string(), text }).strict()).min(1),
  }).strict(),
  z.object({
    kind: z.literal("table"),
    headerRows: z.number().int().min(0),
    rows: z.array(z.array(z.string())).min(1),
  }).strict().refine((table) => table.headerRows <= table.rows.length, {
    message: "headerRows exceeds the number of rows",
    path: ["headerRows"],
  }),
  z.object({ kind: z.literal("page-header"), text }).strict(),
  z.object({ kind: z.literal("page-footer"), text }).strict(),
]);

const pageSchema = z.object({ elements: z.array(elementSchema) }).strict();

/** One layout element as the model returns it, before docture assigns ids and provenance. */
export type LlmOcrElement =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | {
    readonly kind: "list";
    readonly ordered: boolean;
    /** `marker` is the printed bullet or number, such as `"•"` or `"1."`. */
    readonly items: readonly { readonly marker: string; readonly text: string }[];
  }
  | { readonly kind: "table"; readonly headerRows: number; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: "page-header"; readonly text: string }
  | { readonly kind: "page-footer"; readonly text: string };

const SYSTEM = [
  "You transcribe one rendered document page into layout elements, in reading order.",
  "Copy text exactly as printed. Do not summarize, translate, correct, or add text.",
  "heading: a title or section heading, with level 1 to 6 following the visual hierarchy.",
  "paragraph: body text. Join lines that wrap inside one paragraph with single spaces.",
  "list: bulleted or numbered items. Give each item's printed marker, such as \"•\", \"1.\" or \"a)\", and its text without the marker. Set ordered when the markers count.",
  "table: one array per row and one string per cell. headerRows counts the leading rows that label columns.",
  "code: source code or preformatted text, keeping its line breaks.",
  "page-header and page-footer: running headers, footers and page numbers.",
  "Leave out pictures and decoration, but transcribe their captions as paragraphs.",
  "Return no elements for a blank page.",
].join("\n");

function runs(value: string) {
  return [{ text: value }];
}

function elementOf(value: LlmOcrElement, pageNumber: number, index: number): DocumentElement | undefined {
  const base = { id: "", provenance: { pageNumber, box: ZERO_BOX, sourceIds: [`p${pageNumber}-llm-${index + 1}`] } };
  switch (value.kind) {
    case "heading":
    case "paragraph":
      return value.text.trim() === "" ? undefined : { ...base, ...value, runs: runs(value.text) };
    case "code":
      return value.text.trim() === "" ? undefined : { ...base, ...value };
    case "page-header":
    case "page-footer":
      return value.text.trim() === "" ? undefined : { ...base, ...value, runs: runs(value.text), evidence: "tagged" };
    case "list":
      return {
        ...base,
        kind: "list",
        ordered: value.ordered,
        items: value.items.map((item) => ({
          text: item.text,
          runs: runs(item.text),
          ...(item.marker.trim() === "" ? {} : { marker: `${item.marker.trim()} ` }),
        })),
      };
    case "table": {
      const width = Math.max(...value.rows.map((row) => row.length));
      return {
        ...base,
        kind: "table",
        headerRows: value.headerRows,
        rows: value.rows.map((row) => Array.from({ length: width }, (_unused, column) => row[column] ?? "")),
      };
    }
    default: {
      const unhandled: never = value;
      return unhandled;
    }
  }
}

function pageWithElements(raster: RasterPage, elements: readonly LlmOcrElement[]): LayoutPage {
  const page: LayoutPage = {
    pageNumber: raster.pageNumber,
    width: raster.widthPx * raster.scale,
    height: raster.heightPx * raster.scale,
    elements: elements.flatMap((element, index) => elementOf(element, raster.pageNumber, index) ?? []),
  };
  return withElementIds([page])[0] ?? page;
}

interface ReadPage {
  readonly layout: LayoutPage;
  readonly usage: Partial<Usage>;
}

/**
 * Read scanned or image-only PDF pages with a vision-capable model.
 *
 * @remarks LlmOcrLoaderOptions requires a model and a rasterizer. Each page is rendered and sent alone. The model returns headings, paragraphs, lists, tables, code and running headers, which become the page's native layout, so conversion exports them without line analysis. Defaults are dpi 200, maxEdge 1568 and concurrency 4. Token usage is reported in `meta.usage` of the loaded document.
 * @throws MODEL_OUTPUT_FAILED when a page's answer does not fit the layout schema; the message names the page. PAGE_OUT_OF_RANGE for unavailable selected pages. Invalid concurrency throws RangeError.
 * @example
 * ```ts
 * import { llmOcr } from "docture/llm/ocr";
 * import { NapiCanvasRasterizer } from "docture/raster/canvas";
 * const loader = llmOcr({ model: "openai/gpt-5", rasterizer: new NapiCanvasRasterizer() });
 * ```
 */
export class LlmOcrLoader implements DocumentLoader<LoaderCapabilities<true, false, true>> {
  readonly name: string;
  readonly capabilities: LoaderCapabilities<true, false, true> = {
    text: true,
    geometry: false,
    images: true,
    mimeTypes: ["application/pdf"],
  };

  constructor(private readonly options: LlmOcrLoaderOptions) {
    if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency < 1)) {
      throw new RangeError("concurrency must be a positive integer");
    }
    this.name = options.name ?? "llm-ocr";
  }

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();
    const started = Date.now();
    const rendered = await this.options.rasterizer.rasterize(document, {
      dpi: this.options.dpi ?? 200,
      format: this.options.format ?? "png",
      maxEdge: this.options.maxEdge ?? 1568,
      ...(ctx.request?.pages === undefined ? {} : { pages: ctx.request.pages }),
      ...(this.options.maxPages === undefined ? {} : { maxPages: this.options.maxPages }),
    }, { signal: ctx.signal, logger: ctx.logger });
    const byPage = new Map(rendered.map((raster) => [raster.pageNumber, raster]));
    const knownCount = rendered.reduce((count, raster) => Math.max(count, raster.pageNumber), 0);
    const wanted = ctx.request?.pages === undefined
      ? [...byPage.keys()].filter((number) => number <= (this.options.maxPages ?? Infinity)).sort((a, b) => a - b)
      : requestedPageNumbers(knownCount, ctx.request.pages, this.options.maxPages);
    const rasters = wanted.map((number) => {
      const raster = byPage.get(number);
      if (raster === undefined) throw new PageSelectionError([number], knownCount);
      return raster;
    });

    const read = await mapWithConcurrency(
      rasters,
      this.options.concurrency ?? 4,
      (raster, _index, signal) => this.readPage(raster, document, signal),
      ctx.signal,
    );

    const image = pageImageRenderer(this.options.rasterizer, document, ctx);
    const pages = read.map(({ layout }): LoadedPage => ({
      pageNumber: layout.pageNumber,
      width: layout.width,
      height: layout.height,
      text: exportDocument({ pages: [layout] }, "text", "omit", []).content,
      layout: layout.elements,
      image: (options, call) => image(layout.pageNumber, options ?? {}, call?.signal),
    }));
    for (const page of read) {
      ctx.logger.debug("Model read page layout", { pageNumber: page.layout.pageNumber, elements: page.layout.elements.length });
    }
    return {
      pages,
      text: pages.map((page) => page.text).join("\f"),
      form: inferForm(pages.map((page) => page.text.trim().length)),
      loader: this.name,
      meta: {
        pagesRead: pages.length,
        modelId: modelIdOf(this.options.model),
        usage: sumUsage(read.map((page) => page.usage), Date.now() - started),
      },
    };
  }

  private async readPage(raster: RasterPage, document: RawDocument, signal: AbortSignal): Promise<ReadPage> {
    const system = this.options.instructions === undefined ? SYSTEM : `${SYSTEM}\n\n${this.options.instructions}`;
    const content: ContentPart[] = [
      { type: "text", text: `Transcribe page ${raster.pageNumber}.` },
      { type: "file", data: raster.bytes, mediaType: MEDIA_TYPES[raster.format] },
    ];
    const modelId = modelIdOf(this.options.model);
    const format = this.options.format ?? "png";
    const response = await requestObject({
      model: this.options.model,
      modelId,
      schema: pageSchema,
      system,
      input: { messages: [{ role: "user", content }] },
      cache: this.options.cache,
      key: cacheKey({
        provider: providerOf(this.options.model),
        ...(this.options.providerOptions === undefined ? {} : { providerOptions: this.options.providerOptions }),
        modelId,
        temperature: this.options.temperature,
        system,
        prompt: fingerprint(content),
        jsonSchema: z.toJSONSchema(pageSchema),
        variant: `ocr:${format}:${this.options.dpi ?? 200}:${this.options.maxEdge ?? 1568}`,
      }),
      temperature: this.options.temperature,
      maxRetries: this.options.maxRetries,
      providerOptions: this.options.providerOptions,
      pricing: this.options.pricing,
      signal,
      startedAt: Date.now(),
      telemetry: callTelemetry(this.options.telemetry, {
        stage: "vision",
        component: this.name,
        document: document.fileName,
        pages: [raster.pageNumber],
      }),
    }).catch((error: unknown) => {
      if (!(error instanceof ModelOutputError)) throw error;
      throw new ModelOutputError(`Page ${raster.pageNumber}: ${error.message}`, {
        cause: error,
        ...(error.usage === undefined ? {} : { usage: error.usage }),
        ...(error.rawOutput === undefined ? {} : { rawOutput: error.rawOutput }),
        ...(error.finishReason === undefined ? {} : { finishReason: error.finishReason }),
        ...(error.issues === undefined ? {} : { issues: error.issues }),
      });
    });
    const { elements }: { readonly elements: readonly LlmOcrElement[] } = response.data as z.infer<typeof pageSchema>;
    return { layout: pageWithElements(raster, elements), usage: response.usage };
  }
}

/** Functional form of {@link LlmOcrLoader}. */
export function llmOcr(options: LlmOcrLoaderOptions): LlmOcrLoader {
  return new LlmOcrLoader(options);
}
