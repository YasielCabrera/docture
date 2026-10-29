import { canonicalJson, isPlainObject } from "../json.js";
import { indexPath, keyPath } from "../path.js";

type Schema = Readonly<Record<string, unknown>>;

/** Where a value first breaks a schema, and what it must be instead. */
export interface SchemaViolation {
  /** Concrete path, such as `cases[0].score.counts.match`. The root is `""`. */
  readonly path: string;
  readonly message: string;
}

const KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description",
  "type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems",
  "enum", "const", "oneOf", "anyOf",
]);

const NAMES: Readonly<Record<string, string>> = {
  string: "a string",
  number: "a number",
  integer: "an integer",
  boolean: "a boolean",
  object: "an object",
  array: "an array",
  null: "null",
};

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    default:
      return typeof value === type;
  }
}

function either(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function shown(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Check a value against the draft 2020-12 subset the result schema uses, and return the first violation.
 * Properties are checked in schema order before missing and unknown members, so the path names the
 * deepest member that is wrong. A `oneOf` whose branches each fix one property to a constant picks its
 * branch by that property. Numbers must be finite.
 */
export function firstViolation(root: Schema, schema: Schema, value: unknown, path = ""): SchemaViolation | undefined {
  for (const keyword of Object.keys(schema)) if (!KEYWORDS.has(keyword)) throw new TypeError(`Unsupported JSON Schema keyword ${keyword}.`);
  const fail = (at: string, message: string): SchemaViolation => ({ path: at, message });
  if (typeof schema.$ref === "string") {
    const target = (root.$defs as Readonly<Record<string, Schema>> | undefined)?.[schema.$ref.replace("#/$defs/", "")];
    if (target === undefined) throw new TypeError(`Unresolved JSON Schema reference ${schema.$ref}.`);
    const violation = firstViolation(root, target, value, path);
    if (violation !== undefined) return violation;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((type) => hasType(value, type))) return fail(path, `must be ${either(types.map((type) => NAMES[type] ?? type))}`);
  }
  if (schema.const !== undefined && canonicalJson(schema.const) !== canonicalJson(value)) return fail(path, `must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => canonicalJson(option) === canonicalJson(value))) {
    return fail(path, `must be one of ${schema.enum.map(shown).join(", ")}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return fail(path, `must have at least ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return fail(path, `must have at most ${schema.maxItems} items`);
    const items = schema.items as Schema | undefined;
    if (items !== undefined) {
      for (const [index, item] of value.entries()) {
        const violation = firstViolation(root, items, item, indexPath(path, index));
        if (violation !== undefined) return violation;
      }
    }
  }
  if (isPlainObject(value)) {
    const properties = (schema.properties ?? {}) as Readonly<Record<string, Schema>>;
    for (const [key, property] of Object.entries(properties)) {
      if (value[key] === undefined) continue;
      const violation = firstViolation(root, property, value[key], keyPath(path, key));
      if (violation !== undefined) return violation;
    }
    for (const key of (schema.required ?? []) as string[]) if (value[key] === undefined) return fail(keyPath(path, key), "is missing");
    const additional = schema.additionalProperties;
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined || Object.hasOwn(properties, key) || additional === undefined || additional === true) continue;
      if (additional === false) return fail(keyPath(path, key), "is not allowed");
      const violation = firstViolation(root, additional as Schema, child, keyPath(path, key));
      if (violation !== undefined) return violation;
    }
  }
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = schema[keyword] as readonly Schema[] | undefined;
    if (branches === undefined) continue;
    const discriminator = isPlainObject(value) ? discriminatorOf(branches) : undefined;
    if (discriminator !== undefined) {
      const branch = branches.find((option) => canonicalJson((option.properties as Record<string, Schema>)[discriminator]?.const) === canonicalJson((value as Record<string, unknown>)[discriminator]));
      if (branch === undefined) return fail(keyPath(path, discriminator), `must be one of ${branches.map((option) => shown((option.properties as Record<string, Schema>)[discriminator]?.const)).join(", ")}`);
      const violation = firstViolation(root, branch, value, path);
      if (violation !== undefined) return violation;
      continue;
    }
    const passing = branches.filter((option) => firstViolation(root, option, value, path) === undefined).length;
    if (keyword === "oneOf" ? passing !== 1 : passing === 0) return fail(path, "matches none of its allowed shapes");
  }
  return undefined;
}

function discriminatorOf(branches: readonly Schema[]): string | undefined {
  const first = branches[0]?.properties as Readonly<Record<string, Schema>> | undefined;
  return Object.keys(first ?? {}).find((key) => branches.every((option) => (option.properties as Readonly<Record<string, Schema>> | undefined)?.[key]?.const !== undefined));
}
