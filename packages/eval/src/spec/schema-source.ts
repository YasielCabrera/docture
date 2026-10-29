import type { ContractLike } from "docture";
import { isPlainObject } from "../json.js";

export type JsonSchemaObject = Readonly<Record<string, unknown>>;

/** What `defineEval` accepts: a Docture contract, any AI SDK `FlexibleSchema` (Zod, Standard Schema, `jsonSchema()`), or plain JSON Schema. */
export type SchemaInput = ContractLike | JsonSchemaObject;

const AI_SDK_SCHEMA = Symbol.for("vercel.ai.schema");

export type SchemaSource = { readonly ok: true; readonly schema: JsonSchemaObject } | { readonly ok: false; readonly message: string };

function isThenable(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function isContract(value: Record<string, unknown>): boolean {
  return typeof value.name === "string" && value.schema !== undefined && value.type === undefined && value.properties === undefined;
}

/**
 * Read the JSON Schema of a contract or schema synchronously, the way the AI SDK's
 * `asSchema` does, without importing it: an AI SDK schema exposes `jsonSchema`; a
 * Standard Schema exposes `~standard.jsonSchema` (Zod 4.2 and later, ArkType,
 * Valibot); a lazy schema is a function returning one of those.
 */
export function jsonSchemaOf(input: unknown, depth = 0): SchemaSource {
  if (depth > 4) return { ok: false, message: "the schema wraps itself too deeply" };
  if (typeof input === "function") return jsonSchemaOf((input as () => unknown)(), depth + 1);
  if (typeof input !== "object" || input === null) return { ok: false, message: "expected a contract, a schema or a JSON Schema object" };
  const record = input as Record<PropertyKey, unknown>;
  if (record[AI_SDK_SCHEMA] === true) {
    const schema = record.jsonSchema;
    if (isThenable(schema)) return { ok: false, message: "the schema's JSON Schema is asynchronous; await it and pass the JSON Schema object" };
    return isPlainObject(schema) ? { ok: true, schema } : { ok: false, message: "the AI SDK schema has no JSON Schema" };
  }
  const standard = record["~standard"];
  if (typeof standard === "object" && standard !== null) {
    const { vendor, jsonSchema } = standard as { vendor?: unknown; jsonSchema?: { input?: (options: { target: string }) => unknown } };
    if (typeof jsonSchema?.input !== "function") {
      return {
        ok: false,
        message: `the ${String(vendor)} schema cannot produce JSON Schema. Zod 3 and Zod 4.1 schemas need wrapping, for example zodSchema(schema) from "ai", or pass JSON Schema`,
      };
    }
    const schema = jsonSchema.input({ target: "draft-2020-12" });
    return isPlainObject(schema) ? { ok: true, schema } : { ok: false, message: `the ${String(vendor)} schema produced no JSON Schema object` };
  }
  if (isPlainObject(record) && isContract(record)) return jsonSchemaOf(record.schema, depth + 1);
  if (isPlainObject(record)) return { ok: true, schema: record };
  return { ok: false, message: "expected a contract, a schema or a JSON Schema object" };
}
