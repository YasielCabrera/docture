import { parseCalendarDate } from "../compare/date.js";
import { nonNegative, unitInterval } from "../compare/options.js";
import { digitsOf, levenshteinSimilarity, normalizeText } from "../compare/strings.js";
import { MATCH, type Comparator, type Comparison } from "../compare/types.js";
import { fingerprintOf } from "../hash.js";
import { compareCodeUnits } from "../order.js";
import { isPlainObject } from "../json.js";
import { indexPath, keyPath, patternOf } from "../path.js";
import { ScoreCollector, isAbsent } from "../score/engine.js";
import { assembleSpec } from "./define.js";
import type { EvalSpec, ResolvedField } from "./types.js";

/** Options for {@link looseEval}, matching the defaults of Docture's previous `scoreExtraction`. */
export interface LooseEvalOptions {
  /** Absolute tolerance for numbers. Default 0.01. */
  readonly numericTolerance?: number;
  /** String similarity at which two strings match, after digits agree in order. Default 0.9. */
  readonly stringSimilarity?: number;
  /** Sort arrays of objects by this key before pairing rows by index. */
  readonly alignArraysBy?: string;
}

const DATE_WORDS = /^(?:dates?|birthdate|startdate|enddate|issued|due)$/u;

function looksLikeDate(path: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const leaf = path.slice(path.lastIndexOf(".") + 1).replace(/\[\d+\]/gu, "");
  const words = leaf.replace(/([a-z\d])([A-Z])/gu, "$1_$2").toLowerCase().split(/[_-]/u);
  return words.some((word) => DATE_WORDS.test(word)) || words.at(-1) === "at" || /^\d{4}-\d{2}-\d{2}(?:$|[T ])/iu.test(value.trim());
}

function dayOf(value: unknown): number | undefined {
  const parsed = parseCalendarDate(value);
  return parsed === undefined ? undefined : parsed.year * 10_000 + parsed.month * 100 + parsed.day;
}

function isEmptyContainer(value: unknown): boolean {
  return (Array.isArray(value) && value.length === 0) || (isPlainObject(value) && Object.keys(value).length === 0);
}

function looseComparator(numericTolerance: number, stringSimilarity: number): Comparator {
  return {
    id: "loose",
    options: { numericTolerance, stringSimilarity },
    compare(expected, actual, ctx): Comparison {
      if (typeof expected === "boolean" || typeof actual === "boolean") return expected === actual ? MATCH : { match: false, similarity: 0 };
      if (typeof expected === "number" || typeof actual === "number") {
        const a = Number(expected);
        const b = Number(actual);
        if (Number.isNaN(a) || Number.isNaN(b)) return { match: false, similarity: 0 };
        if (Math.abs(a - b) <= numericTolerance) return MATCH;
        return { match: false, similarity: Math.max(0, 1 - Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))) };
      }
      if (looksLikeDate(ctx.path, expected)) {
        const a = dayOf(expected);
        const b = dayOf(actual);
        if (a !== undefined && b !== undefined) return a === b ? MATCH : { match: false, similarity: 0 };
      }
      if (typeof expected === "string" && typeof actual === "string") {
        const a = normalizeText(expected);
        const b = normalizeText(actual);
        if (a === b) return MATCH;
        const similarity = levenshteinSimilarity(a, b);
        if (digitsOf(a) !== digitsOf(b)) return { match: false, similarity };
        return similarity >= stringSimilarity ? { match: true, similarity } : { match: false, similarity };
      }
      if (isEmptyContainer(expected) && isEmptyContainer(actual) && Array.isArray(expected) === Array.isArray(actual)) return MATCH;
      return expected === actual ? MATCH : { match: false, similarity: 0 };
    },
  };
}

function realign(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    const keyed = value.every((element) => isPlainObject(element) && key in element);
    const rows = keyed ? [...value].sort((a, b) => compareCodeUnits(String((a as Record<string, unknown>)[key]), String((b as Record<string, unknown>)[key]))) : value;
    return rows.map((element) => realign(element, key));
  }
  if (isPlainObject(value) && Object.keys(value).length > 0) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, realign(v, key)]));
  return value;
}

type Shape = "array" | "object" | "leaf";

function shapeOf(value: unknown): Shape {
  if (Array.isArray(value) && value.length > 0) return "array";
  if (isPlainObject(value) && Object.keys(value).length > 0) return "object";
  return "leaf";
}

/**
 * A spec with no schema that reproduces the defaults of Docture's previous
 * `scoreExtraction`: numbers within 0.01, strings at similarity 0.9 once their
 * digits agree, date-like strings by calendar day, arrays by index. It is the
 * one spec that does not fail closed; use it for quick checks.
 */
export function looseEval(options: LooseEvalOptions = {}): EvalSpec<unknown> {
  const numericTolerance = nonNegative("looseEval", "numericTolerance", options.numericTolerance) ?? 0.01;
  const stringSimilarity = unitInterval("looseEval", "stringSimilarity", options.stringSimilarity) ?? 0.9;
  const alignBy = options.alignArraysBy;
  const comparator = looseComparator(numericTolerance, stringSimilarity);
  const fieldsByPattern = new Map<string, ResolvedField>();
  const fieldFor = (path: string): ResolvedField => {
    const pattern = patternOf(path);
    let field = fieldsByPattern.get(pattern);
    if (field === undefined) {
      field = { pattern, type: "unknown", comparator, segment: "all", weight: 1, critical: false, source: { kind: "loose" } };
      fieldsByPattern.set(pattern, field);
    }
    return field;
  };
  const descend = (shape: Exclude<Shape, "leaf">, expected: unknown, actual: unknown, path: string, out: ScoreCollector): void => {
    if (shape === "array") {
      const left = Array.isArray(expected) ? expected : [];
      const right = Array.isArray(actual) ? actual : [];
      const paired = Math.min(left.length, right.length);
      out.arrays.push({
        path, pattern: patternOf(path), algorithm: "index", expected: left.length, actual: right.length,
        matched: paired, missing: left.length - paired, extra: right.length - paired, outOfOrder: 0, splits: [], merges: [],
      });
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) walk(left[i], right[i], indexPath(path, i), out);
      return;
    }
    const left = isPlainObject(expected) ? expected : {};
    const right = isPlainObject(actual) ? actual : {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], keyPath(path, key), out);
  };
  const walk = (expected: unknown, actual: unknown, path: string, out: ScoreCollector): void => {
    const e = shapeOf(expected);
    const a = shapeOf(actual);
    if (e === "leaf" && a === "leaf") {
      out.leaf(fieldFor(path), expected, actual, path, path);
      return;
    }
    if (e !== "leaf" && e === a) {
      descend(e, expected, actual, path, out);
      return;
    }
    if (e === "leaf") out.leaf(fieldFor(path), expected, undefined, path, path);
    else descend(e, expected, undefined, path, out);
    if (a === "leaf") out.leaf(fieldFor(path), undefined, actual, path, path);
    else descend(a, undefined, actual, path, out);
  };
  return assembleSpec({
    fingerprint: fingerprintOf({ kind: "loose", numericTolerance, stringSimilarity, alignArraysBy: alignBy ?? null }),
    fields: [],
    arrays: [],
    nulls: "absent",
    assertions: [],
    collect(expected, actual) {
      const collector = new ScoreCollector("absent");
      walk(alignBy === undefined ? expected : realign(expected, alignBy), alignBy === undefined ? actual : realign(actual, alignBy), "", collector);
      return collector;
    },
    validate(expected) {
      return expected === undefined || isAbsent(expected, "absent")
        ? { ok: false, issues: [{ code: "wrong-type", path: "", message: "ground truth is missing" }] }
        : { ok: true, value: expected };
    },
    explain(path) {
      return `${path}: loose(numbers within ${numericTolerance}, strings at similarity ${stringSimilarity}, date-like strings by day) from looseEval defaults`;
    },
  });
}
