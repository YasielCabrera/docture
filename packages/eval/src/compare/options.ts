import type { JsonValue } from "../json.js";

export function nonNegative(owner: string, name: string, value: number | undefined): number | undefined {
  if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${owner}: ${name} must be a finite number of at least 0, got ${String(value)}.`);
  }
  return value;
}

export function unitInterval(owner: string, name: string, value: number | undefined): number | undefined {
  if (value !== undefined && !(Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError(`${owner}: ${name} must be between 0 and 1, got ${String(value)}.`);
  }
  return value;
}

export function oneOfValues<T extends string>(owner: string, name: string, value: T | undefined, allowed: readonly T[]): T | undefined {
  if (value !== undefined && !allowed.includes(value)) {
    throw new RangeError(`${owner}: ${name} must be one of ${allowed.join(", ")}, got ${String(value)}.`);
  }
  return value;
}

/** Keep only the options that were given, so equal configurations serialize equally. */
export function definedOptions(options: Readonly<Record<string, JsonValue | undefined>>): { readonly [key: string]: JsonValue } {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(options)) if (value !== undefined) out[key] = value;
  return out;
}
