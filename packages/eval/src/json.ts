/** Any value JSON can represent. Results, options and extensions use it so every artifact survives `JSON.stringify`. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Convert any value to its JSON form the way `JSON.stringify` would, so a
 * result holds exactly what a saved copy holds. `undefined`, functions,
 * symbols and non-finite numbers become `null`; dates become ISO strings.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "object": {
      if (Array.isArray(value)) return value.map(toJsonValue);
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
      const withToJson = value as { toJSON?: unknown };
      if (typeof withToJson.toJSON === "function") return toJsonValue((withToJson.toJSON as () => unknown).call(value));
      const out: Record<string, JsonValue> = {};
      for (const [key, child] of Object.entries(value)) {
        if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
        out[key] = toJsonValue(child);
      }
      return out;
    }
    default:
      return null;
  }
}

/** `JSON.stringify` with object keys sorted, so equal values always produce equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(toJsonValue(value)));
}

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const object = value as JsonObject;
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(object).sort()) out[key] = sortKeys(object[key] as JsonValue);
    return out;
  }
  return value;
}
