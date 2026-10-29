/**
 * Read the JSON Schema of whatever the user extracts with: a Docture contract, a
 * Standard Schema (Zod 4.2 and later, ArkType, Valibot), an AI SDK schema, or plain
 * JSON Schema. One schema then drives extraction, evaluation and synthesis.
 */

export type JsonSchema = Readonly<Record<string, unknown>>;

/** Anything `defineModel` accepts as the shape of a sample. */
export type SchemaInput = object | (() => object);

const AI_SDK_SCHEMA = Symbol.for("vercel.ai.schema");

export type SchemaSource =
  | { readonly ok: true; readonly schema: JsonSchema; readonly validate?: Validate }
  | { readonly ok: false; readonly message: string };

/** Standard Schema validation, synchronous or not. Returns issue messages keyed by path. */
export type Validate = (value: unknown) => Promise<readonly { readonly path: string; readonly message: string }[]>;

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function readSchema(input: unknown, depth = 0): SchemaSource {
  if (depth > 4) return { ok: false, message: "the schema wraps itself too deeply" };
  if (typeof input === "function") return readSchema((input as () => unknown)(), depth + 1);
  if (typeof input !== "object" || input === null) return { ok: false, message: "expected a contract, a schema or a JSON Schema object" };
  const record = input as Record<PropertyKey, unknown>;
  if (record[AI_SDK_SCHEMA] === true) {
    const schema = record.jsonSchema;
    return isPlainObject(schema) ? { ok: true, schema } : { ok: false, message: "the AI SDK schema has no synchronous JSON Schema" };
  }
  const standard = record["~standard"];
  if (typeof standard === "object" && standard !== null) {
    const { vendor, jsonSchema, validate } = standard as {
      vendor?: unknown;
      jsonSchema?: { input?: (options: { target: string }) => unknown };
      validate?: (value: unknown) => unknown;
    };
    if (typeof jsonSchema?.input !== "function") {
      return { ok: false, message: `the ${String(vendor)} schema cannot produce JSON Schema; pass JSON Schema instead` };
    }
    const schema = jsonSchema.input({ target: "draft-2020-12" });
    if (!isPlainObject(schema)) return { ok: false, message: `the ${String(vendor)} schema produced no JSON Schema object` };
    return typeof validate === "function" ? { ok: true, schema, validate: standardValidate(validate) } : { ok: true, schema };
  }
  if (isPlainObject(record) && typeof record.name === "string" && record.schema !== undefined && record.type === undefined && record.properties === undefined) {
    return readSchema(record.schema, depth + 1);
  }
  if (isPlainObject(record)) return { ok: true, schema: record };
  return { ok: false, message: "expected a contract, a schema or a JSON Schema object" };
}

function standardValidate(validate: (value: unknown) => unknown): Validate {
  return async (value) => {
    const result = (await validate(value)) as { issues?: readonly { message: string; path?: readonly unknown[] }[] };
    return (result.issues ?? []).map((issue) => ({
      path: (issue.path ?? []).map((part) => (typeof part === "object" && part !== null && "key" in part ? String(part.key) : String(part))).join("."),
      message: issue.message,
    }));
  };
}

/** Resolve local `$ref`s and collapse `nullable` unions so callers see one node per position. */
export function resolveNode(root: JsonSchema, node: unknown): { readonly node: JsonSchema; readonly nullable: boolean } {
  let current = node;
  let nullable = false;
  for (let hops = 0; hops < 32; hops++) {
    if (!isPlainObject(current)) return { node: {}, nullable };
    const ref = current.$ref;
    if (typeof ref === "string") {
      current = lookupRef(root, ref);
      continue;
    }
    const union = (current.anyOf ?? current.oneOf) as unknown;
    if (Array.isArray(union)) {
      const nonNull = union.filter((option) => !(isPlainObject(option) && option.type === "null"));
      if (nonNull.length < union.length) nullable = true;
      if (nonNull.length === 1) {
        current = nonNull[0];
        continue;
      }
      return { node: { ...current, anyOf: nonNull }, nullable };
    }
    if (Array.isArray(current.type)) {
      const types = (current.type as unknown[]).filter((type) => type !== "null");
      if (types.length < current.type.length) nullable = true;
      return { node: { ...current, type: types.length === 1 ? types[0] : types }, nullable };
    }
    return { node: current, nullable };
  }
  return { node: {}, nullable };
}

function lookupRef(root: JsonSchema, ref: string): unknown {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/gu, "/").replace(/~0/gu, "~");
    current = isPlainObject(current) ? current[key] : undefined;
  }
  return current;
}
