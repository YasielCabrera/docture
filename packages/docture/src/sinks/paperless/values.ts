import { PaperlessError } from "../../paperless/transport.js";
import type { PaperlessCustomFieldDefinition, PaperlessFieldType, PaperlessValue } from "../../paperless/schema.js";

export function emptyField(type: PaperlessFieldType, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean" || typeof value === "number") return false;
  if (type === "documentlink") return Array.isArray(value) && value.length === 0;
  return !["boolean", "integer", "float"].includes(type) && typeof value === "string" && value.trim() === "";
}

export function valueAt(data: unknown, segments: readonly (string | number)[]): unknown {
  let value = data;
  for (const segment of segments) {
    const key = String(segment);
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

export function nativeValue(definition: PaperlessCustomFieldDefinition, value: unknown, documentId: number): PaperlessValue {
  const fail = (): never => { throw new PaperlessError(`Value for ${definition.name} must match native ${definition.type}.`); };
  switch (definition.type) {
    case "string": {
      if (typeof value !== "string") return fail();
      let characters = 0; for (const _character of value) if (++characters > 128) return fail();
      return value;
    }
    case "longtext": return typeof value === "string" ? value : fail();
    case "url": {
      if (typeof value !== "string" || /\s/u.test(value)) return fail();
      try { new URL(value); return value; } catch { return fail(); }
    }
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return fail();
      const date = new Date(`${value}T00:00:00Z`);
      return !value.startsWith("0000-") && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : fail();
    }
    case "boolean": return typeof value === "boolean" ? value : fail();
    case "integer": return typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : fail();
    case "float": return typeof value === "number" && Number.isFinite(value) ? value : fail();
    case "monetary": {
      const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
      return typeof text === "string" && text.length <= 128 && (/^-?\d{1,10}(?:\.\d{1,2})?$/u.test(text) || /^[A-Z]{3}-?\d+\.\d{1,2}$/u.test(text)) ? text : fail();
    }
    case "select": return typeof value === "string" && definition.options.some((option) => option.id === value) ? value : fail();
    case "documentlink": {
      if (!Array.isArray(value) || !value.every((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) return fail();
      if (value.includes(documentId)) throw new PaperlessError("A documentlink cannot contain a self-link.");
      if (new Set(value).size !== value.length) throw new PaperlessError("Documentlink targets must be distinct.");
      return value;
    }
  }
}

export function sameValue(first: unknown, second: unknown): boolean {
  if (Array.isArray(first) && Array.isArray(second)) return JSON.stringify([...first].sort()) === JSON.stringify([...second].sort());
  return Object.is(first, second);
}
