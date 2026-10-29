import { canonicalJson } from "../json.js";
import { definedOptions, oneOfValues } from "./options.js";
import { normalizeText } from "./strings.js";
import { MATCH, type Comparator } from "./types.js";

/** How `exact` normalizes strings before comparing. */
export type ExactNormalization = "none" | "case" | "whitespace" | "case-and-whitespace";

const NORMALIZERS: Readonly<Record<ExactNormalization, (value: string) => string>> = {
  none: (value) => value,
  case: (value) => value.toLowerCase(),
  whitespace: (value) => value.trim().replace(/\s+/gu, " "),
  "case-and-whitespace": normalizeText,
};

function normalizeDeep(value: unknown, normalize: (value: string) => string): unknown {
  if (typeof value === "string") return normalize(value);
  if (Array.isArray(value)) return value.map((item) => normalizeDeep(item, normalize));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDeep(item, normalize)]));
  }
  return value;
}

function equalUnder(expected: unknown, actual: unknown, normalize: (value: string) => string): boolean {
  if (typeof expected === "string" && typeof actual === "string") return normalize(expected) === normalize(actual);
  if (typeof expected !== "object" && typeof actual !== "object") return expected === actual;
  return canonicalJson(normalizeDeep(expected, normalize)) === canonicalJson(normalizeDeep(actual, normalize));
}

/** Equal JSON values, optionally ignoring case or spacing in strings. A mismatch that only differs in case or spacing gets a hint. */
export function exact(options: { readonly normalize?: ExactNormalization } = {}): Comparator {
  const mode = oneOfValues("exact", "normalize", options.normalize, ["none", "case", "whitespace", "case-and-whitespace"]) ?? "none";
  const normalize = NORMALIZERS[mode];
  return {
    id: "exact",
    options: definedOptions({ normalize: options.normalize }),
    compare(expected, actual) {
      if (equalUnder(expected, actual, normalize)) return MATCH;
      return equalUnder(expected, actual, normalizeText)
        ? { match: false, similarity: 0.9, hint: { kind: "case-or-spacing" } }
        : { match: false, similarity: 0 };
    },
  };
}
