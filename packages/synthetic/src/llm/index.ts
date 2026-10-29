import { MissingEngineError } from "docture";
import type { LanguageModel } from "ai";
import { SynthesisError } from "../errors.js";

/** Supported optional engine of this entry. */
export const ENGINE_RANGES = { ai: "^7.0.0" } as const;

/** A persistent or in-memory store for generated pools, so a corpus rebuilds offline. */
export interface TextPoolCache {
  get(key: string): readonly string[] | undefined | Promise<readonly string[] | undefined>;
  set(key: string, value: readonly string[]): unknown;
}

export interface TextPoolOptions {
  readonly model: LanguageModel;
  /** What the strings are, such as "German company names of small trades". */
  readonly prompt: string;
  readonly count: number;
  readonly cache?: TextPoolCache;
  /** Default 0. */
  readonly temperature?: number;
}

async function loadAi(): Promise<typeof import("ai")> {
  try {
    return await import("ai");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && /^Cannot find package 'ai' imported from /u.test(error.message)) {
      throw new MissingEngineError("ai", ENGINE_RANGES.ai, "@docture/synthetic/llm", { cause: error });
    }
    throw error;
  }
}

const SYSTEM =
  "You write realistic sample values for synthetic test documents. Return exactly the requested number of distinct strings, each a plausible real-world value with no numbering, quotes or commentary.";

/**
 * Ask `model` once for `count` distinct realistic strings and cache them by model, prompt and count.
 * Sample from the pool with `gen.pick(pool)`: ground truth stays the sampled value, and labels are still verified.
 */
export async function llmTextPool(options: TextPoolOptions): Promise<readonly string[]> {
  if (!Number.isInteger(options.count) || options.count < 1) throw new RangeError(`llmTextPool() needs a positive integer count, got ${options.count}`);
  const temperature = options.temperature ?? 0;
  const model = typeof options.model === "string" ? options.model : `${options.model.provider}/${options.model.modelId}`;
  const key = JSON.stringify({ model, prompt: options.prompt, count: options.count, temperature });
  const cached = await options.cache?.get(key);
  if (cached !== undefined) return cached;

  const { generateText, Output, jsonSchema } = await loadAi();
  const response = await generateText({
    model: options.model,
    temperature,
    system: SYSTEM,
    prompt: JSON.stringify({ count: options.count, values: options.prompt }),
    output: Output.object({
      schema: jsonSchema<{ values: string[] }>(
        {
          type: "object",
          additionalProperties: false,
          required: ["values"],
          properties: { values: { type: "array", items: { type: "string" }, minItems: options.count, maxItems: options.count } },
        },
        {
          validate(value: unknown) {
            if (typeof value === "object" && value !== null && "values" in value && Array.isArray(value.values) && value.values.every((item) => typeof item === "string"))
              return { success: true, value: { values: value.values as string[] } };
            return { success: false, error: new Error("Expected { values: string[] }") };
          },
        },
      ),
    }),
  });
  const pool = [...new Set(response.output.values.map((item) => item.trim()).filter((item) => item.length > 0))].slice(0, options.count);
  if (pool.length === 0) throw new SynthesisError([{ path: "llmTextPool", message: `${model} returned no usable strings for "${options.prompt}"` }]);
  await options.cache?.set(key, pool);
  return pool;
}
