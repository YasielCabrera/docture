import type { LanguageModel } from "ai";
import { canonicalDependency } from "../dependencies.js";
import { SynthesisError } from "../errors.js";
import { valuePool, type PoolCache, type ValuePoolOptions } from "../pool.js";
import { isPlainObject } from "../schema.js";
import { loadAi } from "./engine.js";

/** Provider-backed structured values, or an explicit offline read of the same cache identity. */
export type ObjectPoolOptions<Output = unknown> = Pick<ValuePoolOptions<Output>, "schema" | "revision" | "count" | "dependencies"> & {
  readonly prompt: string;
  readonly temperature?: number;
} & (
  | { readonly source: { readonly kind: "model"; readonly model: LanguageModel }; readonly cache?: PoolCache }
  | { readonly source: { readonly kind: "cache-only"; readonly model: string }; readonly cache: PoolCache }
);

/** Ask once for structured records and validate both provider output and cached input through the supplied schema. */
export async function llmObjectPool<Output>(options: ObjectPoolOptions<Output>): Promise<readonly Output[]> {
  if (typeof options.prompt !== "string" || options.prompt.trim().length === 0) throw new RangeError("llmObjectPool() needs a nonempty prompt");
  const temperature = options.temperature ?? 0;
  if (!Number.isFinite(temperature)) throw new RangeError("llmObjectPool() temperature must be finite");
  const model = options.source.model;
  const modelId = typeof model === "string" ? model : `${model.provider}/${model.modelId}`;
  if (modelId.trim().length === 0) throw new RangeError("llmObjectPool() needs a nonempty model identity");
  const id = canonicalDependency({ api: "llmObjectPool/1", model: modelId, prompt: options.prompt, temperature });
  const common = { schema: options.schema, revision: options.revision, count: options.count, ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }) };
  if (options.source.kind === "cache-only") {
    if (options.cache === undefined) throw new RangeError("llmObjectPool() cache-only source needs a cache");
    return valuePool({ ...common, source: { kind: "cache-only", id }, cache: options.cache });
  }
  return valuePool({
    ...common,
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    source: {
      kind: "generate",
      id,
      async generate(count) {
        const { generateText, Output, jsonSchema } = await loadAi();
        const schema = options.schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
        if (!isPlainObject(schema)) throw new SynthesisError([{ path: "llmObjectPool.schema", message: "produced no input JSON Schema object" }]);
        const response = await generateText({
          model,
          temperature,
          system: "Write distinct fictional sample records for synthetic test documents. Return exactly the requested number of records matching the supplied schema.",
          prompt: JSON.stringify({ count, values: options.prompt }),
          output: Output.object({
            schema: jsonSchema<{ values: unknown[] }>({
              type: "object", additionalProperties: false, required: ["values"],
              properties: { values: { type: "array", items: poolItemSchema(schema), minItems: count, maxItems: count } },
            }, {
              validate(value: unknown) {
                if (isPlainObject(value) && Array.isArray(value.values)) return { success: true, value: { values: value.values } };
                return { success: false, error: new Error("Expected { values: [...] }") };
              },
            }),
          }),
        });
        return response.output.values;
      },
    },
  });
}

const SCHEMA_MAPS = new Set(["properties", "patternProperties", "dependentSchemas", "dependencies", "$defs", "definitions"]);
const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_VALUES = new Set(["additionalProperties", "items", "additionalItems", "contains", "not", "if", "then", "else", "propertyNames", "unevaluatedItems", "unevaluatedProperties", "contentSchema"]);
const SCHEMA_REFS = new Set(["$ref", "$dynamicRef", "$recursiveRef"]);

function poolItemSchema(input: Record<string, unknown>, resource = false): Record<string, unknown> {
  const scoped = resource || (typeof input.$id === "string" && input.$id !== "" && input.$id !== "#");
  const childSchema = (child: unknown): unknown => isPlainObject(child) ? poolItemSchema(child, scoped) : structuredClone(child);
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (!scoped && SCHEMA_REFS.has(key) && typeof value === "string" && (value === "#" || value.startsWith("#/"))) {
      return [key, `#/properties/values/items${value.slice(1)}`];
    }
    if (SCHEMA_MAPS.has(key) && isPlainObject(value)) return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, childSchema(child)]))];
    if (SCHEMA_LISTS.has(key) && Array.isArray(value)) return [key, value.map(childSchema)];
    if (SCHEMA_VALUES.has(key)) return [key, Array.isArray(value) ? value.map(childSchema) : childSchema(value)];
    return [key, structuredClone(value)];
  }));
}
