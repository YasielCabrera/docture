/** Constrained model assistance for deterministic document layout. */

import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod/v4";
import type {
  DocumentElement,
  LayoutAnalysis,
  LayoutAnalyzer,
  LayoutAnalyzerContext,
  LayoutAnnotation,
  LayoutElementRole,
} from "../core/index.js";
import { cacheKey, storedUsage, type LlmCache } from "./cache.js";
import { toUsage, type PricingTable } from "./pricing.js";
import { modelIdOf, providerOf } from "./model-id.js";
import { modelOutputError } from "./failure.js";
import { callTelemetry, type LlmTelemetryOptions } from "./telemetry.js";

export type { LlmTelemetryOptions } from "./telemetry.js";

export interface LlmLayoutAnalyzerOptions {
  readonly model: LanguageModel;
  readonly name?: string;
  readonly instructions?: string;
  readonly cache?: LlmCache;
  readonly pricing?: PricingTable;
  readonly temperature?: number;
  readonly maxRetries?: number;
  /** AI SDK telemetry. Inputs and outputs are not recorded unless enabled here. */
  readonly telemetry?: LlmTelemetryOptions;
}

const roles = [
  "heading",
  "paragraph",
  "code",
  "list",
  "table",
  "figure",
  "page-break",
] as const satisfies readonly LayoutElementRole[];
const everyRoleListed: Exclude<LayoutElementRole, (typeof roles)[number]> extends never ? true : false = true;
void everyRoleListed;

const roleSchema = z.enum(roles);

const annotationSchema = z
  .object({
    id: z.string(),
    role: roleSchema.optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).optional(),
    group: z.string().min(1).optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

const analysisSchema = z
  .object({
    annotations: z.array(annotationSchema),
  })
  .strict();

const SYSTEM = [
  "You refine the semantic roles and reading order of already extracted document elements.",
  "Return every supplied element id exactly once. Use only supplied ids.",
  "For each page, order must be a zero-based permutation of that page's elements.",
  "Use a shared group label only for adjacent elements that should form one structure.",
  "You may change paragraph, heading, code, and list roles when evidence supports it.",
  "Do not transcribe, correct, summarize, add, or remove text. The output schema has no text field.",
  "Keep uncertain structures as paragraphs.",
].join("\n");

function contentOf(element: DocumentElement): unknown {
  switch (element.kind) {
    case "heading":
    case "paragraph":
    case "code":
    case "page-header":
    case "page-footer":
      return element.text;
    case "list":
      return element.items.map((item) => item.text);
    case "table":
      return element.rows;
    case "figure":
      return element.alt ?? "(figure)";
    case "page-break":
      return "(page break)";
    default: {
      const unhandled: never = element;
      return unhandled;
    }
  }
}

function promptFor(ctx: LayoutAnalyzerContext): string {
  return JSON.stringify(
    ctx.document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      elements: page.elements.map((element) => ({
        id: element.id,
        role: element.kind,
        box: element.provenance.box,
        content: contentOf(element),
      })),
    })),
  );
}

function annotationsOf(
  values: z.infer<typeof analysisSchema>["annotations"],
): LayoutAnnotation[] {
  return values.map((value) => ({
    id: value.id,
    ...(value.role === undefined ? {} : { role: value.role }),
    ...(value.level === undefined ? {} : { level: value.level }),
    ...(value.group === undefined ? {} : { group: value.group }),
    ...(value.order === undefined ? {} : { order: value.order }),
  }));
}

export class LlmLayoutAnalyzer implements LayoutAnalyzer {
  readonly name: string;

  constructor(private readonly options: LlmLayoutAnalyzerOptions) {
    this.name = options.name ?? "llm-layout";
  }

  async analyze(ctx: LayoutAnalyzerContext): Promise<LayoutAnalysis> {
    const system = `${SYSTEM}${
      this.options.instructions === undefined ? "" : `\n\n${this.options.instructions}`
    }`;
    const prompt = promptFor(ctx);
    const modelId = modelIdOf(this.options.model);
    const schema = z.toJSONSchema(analysisSchema);
    const key =
      this.options.cache === undefined
        ? undefined
        : cacheKey({ provider: providerOf(this.options.model), modelId, temperature: this.options.temperature, system, prompt, jsonSchema: schema, variant: "layout" });
    const cached = key === undefined ? undefined : await this.options.cache?.get(key);
    if (cached !== undefined) {
      return {
        annotations: annotationsOf((cached.data as z.infer<typeof analysisSchema>).annotations),
        usage: toUsage(cached.usage, 0),
      };
    }

    const started = Date.now();
    const response = await generateText({
      model: this.options.model,
      output: Output.object({ schema: analysisSchema }),
      system,
      prompt,
      temperature: this.options.temperature ?? 0,
      maxRetries: this.options.maxRetries ?? 2,
      abortSignal: ctx.signal,
      ...callTelemetry(this.options.telemetry, {
        stage: "layout",
        component: this.name,
        pages: ctx.document.pages.map((page) => page.pageNumber),
      }),
    }).then((response) => ({ output: response.output, usage: response.usage })).catch((error: unknown) => {
      throw modelOutputError(error, {
        modelId, pricing: this.options.pricing, wallMs: Date.now() - started,
      });
    });
    const usage = toUsage(
      response.usage,
      Date.now() - started,
      modelId,
      this.options.pricing,
    );
    if (key !== undefined) {
      await this.options.cache?.set(key, {
        data: response.output,
        usage: storedUsage(response.usage),
      });
    }
    return { annotations: annotationsOf(response.output.annotations), usage };
  }
}

export function llmLayout(options: LlmLayoutAnalyzerOptions): LayoutAnalyzer {
  return new LlmLayoutAnalyzer(options);
}
