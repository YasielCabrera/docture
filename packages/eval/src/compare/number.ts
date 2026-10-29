import { definedOptions, nonNegative } from "./options.js";
import { isAdjacentTransposition } from "./strings.js";
import { MATCH, type Comparator, type Comparison, type RepairHint } from "./types.js";

export interface NumberOptions {
  /** Absolute tolerance. Default 0 unless `rel` is given. */
  readonly abs?: number;
  /** Tolerance relative to the expected magnitude. */
  readonly rel?: number;
  /** Decimal places of the currency's minor unit, used to recognize cents read as units. Default 2. */
  readonly minorUnits?: number;
}

const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu;

/** A finite number, or a string holding exactly one. Text that overflows to infinity is not a number. */
export function toNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && NUMERIC_TEXT.test(value.trim()) ? Number(value.trim()) : undefined;
  return number !== undefined && Number.isFinite(number) ? number : undefined;
}

/** Within `tolerance`, allowing only the few units in the last place that the subtraction itself can lose. */
export function withinTolerance(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance + 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
}

function digits(value: number): string {
  return String(Math.abs(value)).replace(/\D/gu, "");
}

function hintFor(expected: number, actual: number, tolerance: number, minorUnits: number): RepairHint | undefined {
  if (expected !== 0 && withinTolerance(-expected, actual, tolerance)) return { kind: "sign" };
  const minor = 10 ** minorUnits;
  if (withinTolerance(expected * minor, actual, tolerance * minor)) return { kind: "minor-unit", detail: `actual is ${minor}x expected` };
  if (withinTolerance(expected, actual * minor, tolerance)) return { kind: "minor-unit", detail: `expected is ${minor}x actual` };
  if (isAdjacentTransposition(digits(expected), digits(actual))) return { kind: "digit-transposition" };
  if (expected !== 0 && actual !== 0) {
    const exponent = Math.round(Math.log10(Math.abs(actual / expected)));
    if (exponent !== 0 && withinTolerance(expected * 10 ** exponent, actual, tolerance * 10 ** Math.max(0, exponent))) {
      return { kind: "scale", detail: `actual is 10^${exponent} times expected` };
    }
  }
  return undefined;
}

/** Numbers within an absolute or relative tolerance. Mismatches carry sign, minor-unit, scale and transposition hints. */
export function number(options: NumberOptions = {}): Comparator {
  const abs = nonNegative("number", "abs", options.abs) ?? 0;
  const rel = nonNegative("number", "rel", options.rel) ?? 0;
  const minorUnits = nonNegative("number", "minorUnits", options.minorUnits) ?? 2;
  return {
    id: "number",
    options: definedOptions({ abs: options.abs ?? (options.rel === undefined ? 0 : undefined), rel: options.rel, minorUnits: options.minorUnits }),
    compare(expected, actual): Comparison {
      const e = toNumber(expected);
      const a = toNumber(actual);
      if (e === undefined || a === undefined) return { match: false, similarity: 0, note: "not a number" };
      const tolerance = Math.max(abs, rel * Math.abs(e));
      if (withinTolerance(e, a, tolerance)) return MATCH;
      const hint = hintFor(e, a, tolerance, minorUnits);
      const similarity = Math.max(0, 1 - Math.abs(e - a) / Math.max(Math.abs(e), Math.abs(a)));
      return hint === undefined ? { match: false, similarity } : { match: false, similarity, hint };
    },
    check(expected) {
      return typeof expected === "number" && Number.isFinite(expected) ? undefined : "expected a finite number";
    },
  };
}
