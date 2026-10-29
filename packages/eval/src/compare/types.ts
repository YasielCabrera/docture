import type { JsonValue } from "../json.js";

/** A likely cause of a mismatch, so a reader can tell a format slip from a wrong value. */
export interface RepairHint {
  readonly kind:
    | "date-format"
    | "minor-unit"
    | "digit-transposition"
    | "truncation"
    | "case-or-spacing"
    | "sign"
    | "scale"
    | "row-split"
    | "row-merge"
    | "out-of-order"
    | (string & {});
  readonly detail?: string;
}

/** The outcome of comparing one expected value with one actual value. */
export interface Comparison {
  readonly match: boolean;
  /** 0 to 1. Alignment uses it to pair rows, so a near miss should score higher than a wild one. */
  readonly similarity: number;
  readonly hint?: RepairHint;
  readonly note?: string;
}

/** Where a comparison happens. */
export interface CompareContext {
  /** Concrete expected path, such as `lineItems[2].amount`. */
  readonly path: string;
  /** Schema pattern, such as `lineItems[].amount`. */
  readonly pattern: string;
  readonly signal?: AbortSignal;
}

/** Decides whether an actual value matches an expected one. Typed by its members, so a comparator from any copy fits. */
export interface Comparator<E = unknown> {
  readonly id: string;
  /** Serializable options, shown by `spec.explain` and hashed into the spec fingerprint. */
  readonly options?: JsonValue;
  /** True when `compare` returns a promise. Specs with one need `scoreAsync`. */
  readonly async?: boolean;
  compare(expected: E, actual: unknown, ctx: CompareContext): Comparison | Promise<Comparison>;
  /** Strict validation of a ground-truth value. Returns the problem, or `undefined` when the value is acceptable. */
  check?(expected: unknown): string | undefined;
}

/** Declare a custom comparator. Identity at runtime; it pins the type. */
export function defineComparator<E>(comparator: Comparator<E>): Comparator<E> {
  return comparator;
}

export const MATCH: Comparison = { match: true, similarity: 1 };

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/** Run a comparator that must answer synchronously. */
export function compareSync(comparator: Comparator, expected: unknown, actual: unknown, ctx: CompareContext): Comparison {
  const outcome = comparator.compare(expected, actual, ctx);
  if (isPromiseLike(outcome)) {
    throw new TypeError(`Comparator "${comparator.id}" returned a promise at ${ctx.path}. Declare it with async: true and score with spec.scoreAsync.`);
  }
  return outcome;
}

/** Render a comparator for `spec.explain`, such as `number(abs 0.01)`. */
export function describeComparator(comparator: Pick<Comparator, "id" | "options">): string {
  const options = comparator.options;
  if (options === undefined || options === null) return `${comparator.id}()`;
  if (typeof options !== "object" || Array.isArray(options)) return `${comparator.id}(${JSON.stringify(options)})`;
  const parts = Object.entries(options).map(([key, value]) => `${key} ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return `${comparator.id}(${parts.join(", ")})`;
}
