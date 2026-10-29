import type { SpecProblem } from "../errors.js";
import { isPlainObject, type JsonValue } from "../json.js";
import { formatPattern, type PatternToken } from "../path.js";
import type { JsonSchemaObject } from "./schema-source.js";
import type { FieldType } from "./types.js";

export const ANNOTATION = "x-docture-eval";

/** A JSON Schema reduced to what scoring needs: objects, arrays and typed leaves. */
export type SchemaNode =
  | { readonly kind: "object"; readonly properties: ReadonlyMap<string, SchemaNode>; readonly additional?: SchemaNode; readonly open: boolean; readonly nullable: boolean; readonly annotation?: unknown }
  | { readonly kind: "array"; readonly items: SchemaNode; readonly nullable: boolean; readonly annotation?: unknown }
  | { readonly kind: "leaf"; readonly type: FieldType | "null"; readonly values?: readonly JsonValue[]; readonly nullable: boolean; readonly annotation?: unknown };

const SCALAR_TYPES: Readonly<Record<string, FieldType | "null">> = {
  string: "string",
  number: "number",
  integer: "integer",
  boolean: "boolean",
  null: "null",
};

interface Walk {
  readonly root: JsonSchemaObject;
  readonly problems: SpecProblem[];
  readonly refs: Set<string>;
}

function unknownLeaf(annotation: unknown, nullable = false): SchemaNode {
  return { kind: "leaf", type: "unknown", nullable, ...(annotation === undefined ? {} : { annotation }) };
}

function withNullable(node: SchemaNode, nullable: boolean, annotation: unknown): SchemaNode {
  const merged = annotation ?? node.annotation;
  return { ...node, nullable: node.nullable || nullable, ...(merged === undefined ? {} : { annotation: merged }) };
}

function resolveRef(walk: Walk, ref: string): unknown {
  if (!ref.startsWith("#")) return undefined;
  let current: unknown = walk.root;
  for (const raw of ref.slice(1).split("/").slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function merge(nodes: readonly SchemaNode[], annotation: unknown): SchemaNode {
  const nullable = nodes.some((node) => node.nullable || (node.kind === "leaf" && node.type === "null"));
  const real = nodes.filter((node) => !(node.kind === "leaf" && node.type === "null"));
  const first = real[0];
  if (first === undefined) return { kind: "leaf", type: "null", nullable: true };
  if (real.length === 1) return withNullable(first, nullable, annotation);
  if (real.every((node) => node.kind === "object")) {
    const properties = new Map<string, SchemaNode>();
    for (const node of real) {
      for (const [key, child] of node.properties) {
        const existing = properties.get(key);
        properties.set(key, existing === undefined ? child : merge([existing, child], undefined));
      }
    }
    return { kind: "object", properties, open: real.some((node) => node.open), nullable, ...(annotation === undefined ? {} : { annotation }) };
  }
  const leaves = real.filter((node): node is Extract<SchemaNode, { kind: "leaf" }> => node.kind === "leaf");
  if (leaves.length === real.length) {
    const types = new Set(leaves.map((node) => node.type));
    const [type] = types;
    if (types.size === 1 && type !== undefined) {
      const values = leaves.every((node) => node.values !== undefined) ? leaves.flatMap((node) => node.values ?? []) : undefined;
      return { kind: "leaf", type, nullable, ...(values === undefined ? {} : { values }), ...(annotation === undefined ? {} : { annotation }) };
    }
    if ([...types].every((entry) => entry === "number" || entry === "integer")) return { kind: "leaf", type: "number", nullable, ...(annotation === undefined ? {} : { annotation }) };
  }
  return unknownLeaf(annotation, nullable);
}

function stringType(format: unknown): FieldType {
  if (format === "date") return "date";
  if (format === "date-time") return "date-time";
  return "string";
}

function node(walk: Walk, schema: unknown, tokens: readonly PatternToken[]): SchemaNode {
  if (schema === true || (isPlainObject(schema) && Object.keys(schema).every((key) => key === ANNOTATION || key === "description" || key === "title" || key === "$schema"))) {
    return unknownLeaf(isPlainObject(schema) ? schema[ANNOTATION] : undefined);
  }
  if (!isPlainObject(schema)) {
    walk.problems.push({ code: "unsupported-schema", path: formatPattern(tokens), message: "the schema at this path accepts nothing" });
    return unknownLeaf(undefined);
  }
  const annotation = schema[ANNOTATION];
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (walk.refs.has(ref)) {
      walk.problems.push({ code: "unsupported-schema", path: formatPattern(tokens), message: `recursive schema through ${ref}; describe this path with a rule that compares it as one value` });
      return unknownLeaf(annotation);
    }
    const target = resolveRef(walk, ref);
    if (target === undefined) {
      walk.problems.push({ code: "unsupported-schema", path: formatPattern(tokens), message: `cannot resolve ${ref}` });
      return unknownLeaf(annotation);
    }
    walk.refs.add(ref);
    const resolved = node(walk, target, tokens);
    walk.refs.delete(ref);
    return withNullable(resolved, false, annotation);
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[keyword];
    if (Array.isArray(variants)) {
      const { [keyword]: _variants, ...rest } = schema;
      const own = Object.keys(rest).some((key) => key !== ANNOTATION && key !== "description" && key !== "title") ? [node(walk, rest, tokens)] : [];
      return merge([...own, ...variants.map((variant) => node(walk, variant, tokens))], annotation);
    }
  }
  if (Array.isArray(schema.enum) || "const" in schema) {
    const values = (Array.isArray(schema.enum) ? schema.enum : [schema.const]) as JsonValue[];
    const nonNull = values.filter((value) => value !== null);
    return { kind: "leaf", type: "enum", values: nonNull, nullable: nonNull.length < values.length, ...(annotation === undefined ? {} : { annotation }) };
  }
  const declared = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  const nullable = declared.includes("null");
  const types = declared.filter((type) => type !== "null");
  if (types.length === 0 && nullable) return { kind: "leaf", type: "null", nullable: true, ...(annotation === undefined ? {} : { annotation }) };
  const type = types.length === 1 ? types[0] : types.length === 0 ? inferType(schema) : undefined;
  if (type === undefined) {
    if (types.length > 1 && types.every((entry) => entry === "number" || entry === "integer")) return { kind: "leaf", type: "number", nullable, ...(annotation === undefined ? {} : { annotation }) };
    return unknownLeaf(annotation, nullable);
  }
  if (type === "object") return objectNode(walk, schema, tokens, nullable, annotation);
  if (type === "array") {
    if (schema.prefixItems !== undefined || Array.isArray(schema.items)) {
      walk.problems.push({ code: "unsupported-schema", path: formatPattern(tokens), message: "tuple arrays are not supported; compare this path as one value with an exact rule" });
      return { kind: "leaf", type: "array", nullable, ...(annotation === undefined ? {} : { annotation }) };
    }
    const items = schema.items === undefined ? unknownLeaf(undefined) : node(walk, schema.items, [...tokens, { kind: "items" }]);
    return { kind: "array", items, nullable, ...(annotation === undefined ? {} : { annotation }) };
  }
  const scalar = type === "string" ? stringType(schema.format) : SCALAR_TYPES[String(type)];
  if (scalar === undefined) return unknownLeaf(annotation, nullable);
  return { kind: "leaf", type: scalar, nullable, ...(annotation === undefined ? {} : { annotation }) };
}

function inferType(schema: Readonly<Record<string, unknown>>): string | undefined {
  if (schema.properties !== undefined || schema.additionalProperties !== undefined) return "object";
  if (schema.items !== undefined || schema.prefixItems !== undefined) return "array";
  return undefined;
}

function constrains(schema: unknown): boolean {
  return isPlainObject(schema) && Object.keys(schema).some((key) => key !== "description" && key !== "title");
}

function objectNode(walk: Walk, schema: Readonly<Record<string, unknown>>, tokens: readonly PatternToken[], nullable: boolean, annotation: unknown): SchemaNode {
  const properties = new Map<string, SchemaNode>();
  const declared = isPlainObject(schema.properties) ? schema.properties : {};
  for (const [key, child] of Object.entries(declared)) properties.set(key, node(walk, child, [...tokens, { kind: "key", key }]));
  const extra = schema.additionalProperties;
  const open = extra === true || (isPlainObject(extra) && !constrains(extra));
  if (properties.size === 0 && !constrains(extra) && !open) {
    return { kind: "leaf", type: "object", nullable, ...(annotation === undefined ? {} : { annotation }) };
  }
  const additional = constrains(extra) ? node(walk, extra, [...tokens, { kind: "any-key" }]) : undefined;
  return {
    kind: "object",
    properties,
    open: open && additional === undefined,
    nullable,
    ...(additional === undefined ? {} : { additional }),
    ...(annotation === undefined ? {} : { annotation }),
  };
}

/** Reduce a JSON Schema to a scoring tree, reporting what cannot be represented. */
export function schemaTree(root: JsonSchemaObject, problems: SpecProblem[]): SchemaNode {
  return node({ root, problems, refs: new Set() }, root, []);
}
