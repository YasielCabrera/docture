/**
 * Field-level scoring for structured extraction.
 *
 * Pure functions, no test runner, no I/O — so the same grader serves a vitest
 * assertion, a CI gate and a CLI report, and a strategy cannot be graded two
 * different ways depending on who asked.
 *
 * The metric is precision / recall / F1 over flattened leaf paths, with typed
 * comparators, because whole-document exact match is too blunt to steer by: one
 * misread digit and every document scores zero, which tells you nothing about
 * whether a change helped. Exact match is still reported, as a stricter secondary
 * signal.
 */

export type FieldStatus = "match" | "mismatch" | "omission" | "hallucination";

export interface FieldResult {
  /** Dotted leaf path, e.g. `lineItems[3].amount`. */
  readonly path: string;
  readonly status: FieldStatus;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface Score {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Every scored field matched. */
  readonly exactMatch: boolean;
  readonly counts: Readonly<Record<FieldStatus, number>>;
  readonly fields: readonly FieldResult[];
}

export interface ScoreOptions {
  /** Absolute tolerance for numbers. Default 0.01 — one cent. */
  readonly numericTolerance?: number;
  /**
   * Minimum similarity for two strings to count as a match, 0–1. Default 0.9,
   * which forgives an OCR character slip in a long name without accepting a
   * different name.
   */
  readonly stringSimilarity?: number;
  /**
   * Align array elements by a key field instead of by index. Index alignment is
   * the default and is what you want for a table, where document order is
   * meaningful; key alignment is for sets where it is not.
   */
  readonly alignArraysBy?: string;
}

const DEFAULTS = {
  numericTolerance: 0.01,
  stringSimilarity: 0.9,
} as const;

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

/** Flatten to leaf paths. Objects recurse; arrays index; everything else is a leaf. */
function flatten(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, []);
    else value.forEach((element, i) => flatten(element, `${prefix}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.set(prefix, {});
    else {
      for (const [key, child] of entries) {
        flatten(child, prefix === "" ? key : `${prefix}.${key}`, out);
      }
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

function normalizeString(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Levenshtein distance, two rows at a time. */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_unused, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitution,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/** A date-ish leaf: the path says so, or the value is ISO-shaped. */
function looksLikeDate(path: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /date|at$|_at|issued|due/i.test(path) || /^\d{4}-\d{2}-\d{2}/.test(value);
}

function toDay(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Are two leaves equal? The comparator is chosen by type, then by path.
 *
 * Numbers get a tolerance because 1234.56 and 1234.5599999 are the same money.
 * Dates are compared as days, so "2026-01-15" matches "2026-01-15T00:00:00Z".
 * Strings get a similarity floor, so one OCR slip in a company name is not a miss.
 */
function leavesMatch(
  path: string,
  expected: unknown,
  actual: unknown,
  options: Required<Pick<ScoreOptions, "numericTolerance" | "stringSimilarity">>,
): boolean {
  if (typeof expected === "boolean" || typeof actual === "boolean") return expected === actual;

  if (typeof expected === "number" || typeof actual === "number") {
    const a = Number(expected);
    const b = Number(actual);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return Math.abs(a - b) <= options.numericTolerance;
  }

  if (looksLikeDate(path, expected)) {
    const a = toDay(expected);
    const b = toDay(actual);
    if (a !== undefined && b !== undefined) return a === b;
  }

  if (typeof expected === "string" && typeof actual === "string") {
    const a = normalizeString(expected);
    const b = normalizeString(actual);
    if (a === b) return true;
    return similarity(a, b) >= options.stringSimilarity;
  }

  return expected === actual;
}

/**
 * Re-key arrays by a field so alignment does not depend on order.
 *
 * Only applied when `alignArraysBy` is set: for a table, index alignment is
 * correct and cheaper, and silently reordering rows would hide a real ordering bug.
 */
function realign(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    const keyed = value.every(
      (element) => element !== null && typeof element === "object" && key in element,
    );
    if (!keyed) return value.map((element) => realign(element, key));
    const sorted = [...value].sort((a, b) =>
      String((a as Record<string, unknown>)[key]).localeCompare(
        String((b as Record<string, unknown>)[key]),
      ),
    );
    return sorted.map((element) => realign(element, key));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, realign(v, key)]),
    );
  }
  return value;
}

export function scoreExtraction(
  expected: unknown,
  actual: unknown,
  options: ScoreOptions = {},
): Score {
  const settings = {
    numericTolerance: options.numericTolerance ?? DEFAULTS.numericTolerance,
    stringSimilarity: options.stringSimilarity ?? DEFAULTS.stringSimilarity,
  };

  const left =
    options.alignArraysBy === undefined ? expected : realign(expected, options.alignArraysBy);
  const right =
    options.alignArraysBy === undefined ? actual : realign(actual, options.alignArraysBy);

  const expectedLeaves = flatten(left);
  const actualLeaves = flatten(right);
  const paths = new Set([...expectedLeaves.keys(), ...actualLeaves.keys()]);

  const fields: FieldResult[] = [];
  const counts: Record<FieldStatus, number> = {
    match: 0,
    mismatch: 0,
    omission: 0,
    hallucination: 0,
  };

  for (const path of paths) {
    const expectedValue = expectedLeaves.get(path);
    const actualValue = actualLeaves.get(path);
    const expectedHas = isPresent(expectedValue);
    const actualHas = isPresent(actualValue);

    let status: FieldStatus;
    if (expectedHas && actualHas) {
      status = leavesMatch(path, expectedValue, actualValue, settings) ? "match" : "mismatch";
    } else if (expectedHas) {
      status = "omission";
    } else if (actualHas) {
      // A value where ground truth has none: the model invented it.
      status = "hallucination";
    } else {
      continue; // Both absent — nothing to score.
    }

    counts[status] += 1;
    fields.push({ path, status, expected: expectedValue, actual: actualValue });
  }

  const predicted = counts.match + counts.mismatch + counts.hallucination;
  const relevant = counts.match + counts.mismatch + counts.omission;
  const precision = predicted === 0 ? 1 : counts.match / predicted;
  const recall = relevant === 0 ? 1 : counts.match / relevant;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    exactMatch: counts.mismatch === 0 && counts.omission === 0 && counts.hallucination === 0,
    counts,
    fields: fields.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Only the fields that went wrong — what you actually read when a run regresses. */
export function failures(score: Score): readonly FieldResult[] {
  return score.fields.filter((f) => f.status !== "match");
}

/** Fields the extraction invented. Worth separating: a hallucination is not a typo. */
export function hallucinations(score: Score): readonly FieldResult[] {
  return score.fields.filter((f) => f.status === "hallucination");
}
