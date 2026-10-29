import { solveAssignment } from "../align/assignment.js";
import { toJsonValue, type JsonValue } from "../json.js";
import { definedOptions, oneOfValues, unitInterval } from "./options.js";
import { MATCH, compareSync, type Comparator, type Comparison, type CompareContext } from "./types.js";

type Primitive = string | number | boolean;

/** A closed vocabulary: the actual value must equal the expected one, and ground truth must be one of `values`. */
export function oneOf(values: readonly Primitive[], options: { readonly normalize?: "none" | "case" } = {}): Comparator {
  if (values.length === 0) throw new RangeError("oneOf: values must not be empty.");
  const mode = oneOfValues("oneOf", "normalize", options.normalize, ["none", "case"]) ?? "none";
  const key = (value: unknown): unknown => (mode === "case" && typeof value === "string" ? value.toLowerCase() : value);
  const allowed = new Set(values.map(key));
  return {
    id: "oneOf",
    options: definedOptions({ values: [...values], normalize: options.normalize }),
    compare(expected, actual) {
      if (key(expected) === key(actual)) return MATCH;
      return allowed.has(key(actual)) ? { match: false, similarity: 0 } : { match: false, similarity: 0, note: "actual is not an allowed value" };
    },
    check(expected) {
      return allowed.has(key(expected)) ? undefined : `expected one of ${values.map(String).join(", ")}`;
    },
  };
}

/**
 * An unordered collection compared as a whole. Elements pair by the best total
 * similarity; the collection matches when every element pairs with a match and
 * neither side has extras. Similarity is the share of matched elements.
 */
export function setOf(element: Comparator, options: { readonly minSimilarity?: number } = {}): Comparator {
  if (element.async === true) throw new RangeError("setOf: the element comparator must be synchronous.");
  const minSimilarity = unitInterval("setOf", "minSimilarity", options.minSimilarity) ?? 0;
  const describe: JsonValue = { id: element.id, ...(element.options === undefined ? {} : { options: element.options }) };
  return {
    id: "setOf",
    options: definedOptions({ of: describe, minSimilarity: options.minSimilarity }),
    compare(expected, actual, ctx: CompareContext): Comparison {
      const e = Array.isArray(expected) ? expected : [];
      const a = Array.isArray(actual) ? actual : actual === undefined || actual === null ? [] : [actual];
      if (e.length === 0 && a.length === 0) return MATCH;
      if (e.length === 0 || a.length === 0) return { match: false, similarity: 0 };
      const outcomes: Comparison[] = [];
      const cost = new Float64Array(e.length * a.length);
      e.forEach((left, i) => a.forEach((right, j) => {
        const outcome = compareSync(element, left, right, ctx);
        outcomes.push(outcome);
        cost[i * a.length + j] = outcome.similarity >= minSimilarity ? 1 - outcome.similarity : 1;
      }));
      let matched = 0;
      solveAssignment(cost, e.length, a.length).forEach((j, i) => {
        if (j >= 0 && outcomes[i * a.length + j]?.match === true) matched += 1;
      });
      const similarity = (2 * matched) / (e.length + a.length);
      return matched === e.length && e.length === a.length ? MATCH : { match: false, similarity, note: `${matched} of ${e.length} expected elements matched` };
    },
    check(expected) {
      if (!Array.isArray(expected)) return "expected an array";
      for (const item of expected) {
        const problem = element.check?.(item);
        if (problem !== undefined) return `element ${JSON.stringify(toJsonValue(item))}: ${problem}`;
      }
      return undefined;
    },
  };
}
