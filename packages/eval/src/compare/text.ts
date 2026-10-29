import { definedOptions, oneOfValues, unitInterval } from "./options.js";
import { anlsSimilarity, digitsOf, isAdjacentTransposition, isTruncation, levenshteinSimilarity, normalizeText } from "./strings.js";
import { MATCH, type Comparator, type Comparison, type RepairHint } from "./types.js";

export interface TextOptions {
  /** Similarity from 0 to 1 at which two strings match. */
  readonly minSimilarity: number;
  /** `levenshtein` (default) or `anls`, which drops to 0 once the normalized distance reaches `tau`. */
  readonly metric?: "levenshtein" | "anls";
  /** ANLS cutoff. Default 0.5. */
  readonly tau?: number;
  /**
   * `in-order` (default) requires the digits of both strings to be equal in order
   * before similarity applies, so a changed digit in an address or name is never a near match.
   * `ignore` compares by similarity alone.
   */
  readonly digits?: "in-order" | "ignore";
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function stringHint(expected: string, actual: string): RepairHint | undefined {
  if (isTruncation(expected, actual)) return { kind: "truncation" };
  if (isAdjacentTransposition(expected, actual) || isAdjacentTransposition(digitsOf(expected), digitsOf(actual))) {
    return { kind: "digit-transposition" };
  }
  return undefined;
}

function miss(similarity: number, hint: RepairHint | undefined, note?: string): Comparison {
  return { match: false, similarity, ...(hint === undefined ? {} : { hint }), ...(note === undefined ? {} : { note }) };
}

/** Strings by similarity after lowercasing and collapsing whitespace. */
export function text(options: TextOptions): Comparator {
  const minSimilarity = unitInterval("text", "minSimilarity", options.minSimilarity);
  if (minSimilarity === undefined) throw new RangeError("text: minSimilarity is required.");
  const metric = oneOfValues("text", "metric", options.metric, ["levenshtein", "anls"]) ?? "levenshtein";
  const tau = unitInterval("text", "tau", options.tau) ?? 0.5;
  const digits = oneOfValues("text", "digits", options.digits, ["in-order", "ignore"]) ?? "in-order";
  const similarityOf = metric === "anls" ? (a: string, b: string) => anlsSimilarity(a, b, tau) : levenshteinSimilarity;
  return {
    id: "text",
    options: definedOptions({ minSimilarity, metric: options.metric, tau: options.tau, digits: options.digits }),
    compare(expected, actual) {
      const e = scalar(expected);
      const a = scalar(actual);
      if (e === undefined || a === undefined) return miss(0, undefined, "not text");
      const ne = normalizeText(e);
      const na = normalizeText(a);
      if (ne === na) return MATCH;
      const similarity = similarityOf(ne, na);
      if (digits === "in-order" && digitsOf(ne) !== digitsOf(na)) return miss(similarity, stringHint(ne, na), "digits differ");
      return similarity >= minSimilarity ? { match: true, similarity } : miss(similarity, stringHint(ne, na));
    },
    check(expected) {
      return typeof expected === "string" ? undefined : "expected a string";
    },
  };
}

const DEFAULT_STRIP = " -./";

/** Identifiers such as IBANs, references and plates: equal after removing spacing and separators and ignoring case. */
export function identifier(options: { readonly strip?: string } = {}): Comparator {
  const strip = new Set([...(options.strip ?? DEFAULT_STRIP)]);
  const canonical = (value: string): string => [...value].filter((char) => !strip.has(char) && !/\s/u.test(char)).join("").toUpperCase();
  return {
    id: "identifier",
    options: definedOptions({ strip: options.strip }),
    compare(expected, actual) {
      const e = scalar(expected);
      const a = scalar(actual);
      if (e === undefined || a === undefined) return miss(0, undefined, "not an identifier");
      const ce = canonical(e);
      const ca = canonical(a);
      if (ce === ca) return MATCH;
      return miss(levenshteinSimilarity(ce, ca), stringHint(ce, ca));
    },
    check(expected) {
      return typeof expected === "string" || typeof expected === "number" ? undefined : "expected a string or number";
    },
  };
}
