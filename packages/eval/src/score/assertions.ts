import { toNumber } from "../compare/number.js";
import { nonNegative } from "../compare/options.js";
import { isPlainObject, toJsonValue, type JsonValue } from "../json.js";
import { parsePathText } from "../path.js";

/** The outcome of an assertion on one value. */
export type AssertionOutcome =
  | { readonly status: "pass" }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "fail"; readonly message: string; readonly expected?: JsonValue; readonly actual?: JsonValue };

/** A cross-field rule, such as line items summing to the total. Checked on ground truth by `validate` and on output by `score`. */
export interface Assertion {
  readonly id: string;
  /** Paths the assertion reads. `defineEval` checks that each exists in the schema. */
  readonly paths?: readonly string[];
  /** Serializable configuration, hashed into the spec fingerprint so a changed tolerance changes the spec. */
  readonly options?: JsonValue;
  check(value: unknown): AssertionOutcome;
}

/** An assertion's outcome on one case's output. */
export type AssertionResult = { readonly id: string } & AssertionOutcome;

/** Declare a custom assertion. Identity at runtime; it pins the type. */
export function defineAssertion(assertion: Assertion): Assertion {
  return assertion;
}

/** Every value at a path, expanding `[]` over array rows. Absent containers contribute nothing. */
export function valuesAt(value: unknown, path: string): unknown[] {
  const tokens = parsePathText(path);
  if (tokens === undefined) throw new RangeError(`"${path}" is not a path.`);
  let current: unknown[] = [value];
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const item of current) {
      if (token.kind === "key") {
        if (isPlainObject(item) && Object.hasOwn(item, token.key)) next.push(item[token.key]);
      } else if (Array.isArray(item)) {
        if (token.kind === "items") next.push(...item);
        else if (token.index < item.length) next.push(item[token.index]);
      }
    }
    current = next;
  }
  return current;
}

function absent(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** `sumOf("lineItems[].amount").equals("totals.total", { abs: 0.01 })`: the values at one path sum to the value at another. */
export function sumOf(path: string): { equals(target: string, options?: { readonly abs?: number }): Assertion } {
  return {
    equals(target, options = {}) {
      const tolerance = nonNegative("sumOf", "abs", options.abs) ?? 0;
      valuesAt(undefined, path);
      valuesAt(undefined, target);
      return {
        id: `sum(${path}) = ${target}`,
        paths: [path, target],
        options: { abs: tolerance },
        check(value) {
          const totals = valuesAt(value, target).filter((item) => !absent(item));
          const total = totals.length === 1 ? toNumber(totals[0]) : undefined;
          if (totals.length === 0) return { status: "skipped", reason: `${target} is absent` };
          if (total === undefined) return { status: "fail", message: `${target} is not a single number`, actual: toJsonValue(totals) };
          let sum = 0;
          let magnitude = Math.abs(total);
          let terms = 1;
          for (const item of valuesAt(value, path)) {
            if (absent(item)) continue;
            const amount = toNumber(item);
            if (amount === undefined) return { status: "fail", message: `${path} holds a value that is not a number`, actual: toJsonValue(item) };
            sum += amount;
            magnitude += Math.abs(amount);
            terms += 1;
          }
          // Each addition can lose half a unit in the last place of the running magnitude; nothing beyond that is forgiven.
          return Math.abs(sum - total) <= tolerance + terms * Number.EPSILON * magnitude
            ? { status: "pass" }
            : { status: "fail", message: `${path} sums to ${sum}, not ${total}`, expected: total, actual: sum };
        },
      };
    },
  };
}
