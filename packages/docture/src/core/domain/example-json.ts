import { formatFieldPath } from "./field-path.js";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toJson(value: unknown, label: string, path: readonly (string | number)[], ancestors: Set<object>): Json {
  const fail = (what: string): never => {
    throw new TypeError(`${label}: output${path.length === 0 ? "" : ` at ${formatFieldPath(path)}`} is ${what}, which JSON cannot carry.`);
  };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : fail(String(value));
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fail("an invalid Date") : value.toISOString();
  if (Array.isArray(value) || isPlainObject(value)) {
    if (ancestors.has(value)) return fail("a circular reference");
    ancestors.add(value);
    const json: Json = Array.isArray(value)
      ? value.map((item: unknown, index) => toJson(item, label, [...path, index], ancestors))
      : Object.fromEntries(Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toJson(item, label, [...path, key], ancestors)]));
    ancestors.delete(value);
    return json;
  }
  if (value === undefined) return fail("undefined");
  return fail(typeof value === "object" ? `a ${value.constructor?.name ?? "non-plain object"}` : `a ${typeof value}`);
}

export function exampleJson(example: { readonly text: unknown; readonly output: unknown }, label: string): string {
  if (typeof example.text !== "string") throw new TypeError(`${label}: text must be a string.`);
  return JSON.stringify(toJson(example.output, label, [], new Set()));
}
