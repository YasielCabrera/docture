import type { ArrayRule } from "../align/rules.js";
import type { EvalCase } from "../case.js";
import type { Comparator } from "../compare/types.js";
import type { GroundTruthIssue } from "../errors.js";
import type { FieldEvidence } from "../extractor.js";
import type { JsonValue } from "../json.js";
import type { Assertion } from "../score/assertions.js";
import type { CaseScore } from "../score/types.js";

/** The schema type of a leaf. `object` and `array` are containers a rule compares as a whole. */
export type FieldType = "string" | "number" | "integer" | "boolean" | "enum" | "date" | "date-time" | "object" | "array" | "unknown";

/** Field-level settings. A rule without `compare` keeps the comparator from the annotation or type default. */
export interface FieldRuleOptions {
  readonly compare?: Comparator;
  /** Weight in precision, recall and F1. Default 1. */
  readonly weight?: number;
  /** A case with a critical field that does not match reports `metrics.critical: false`. */
  readonly critical?: boolean;
  /** Overrides segment membership from `segments`. */
  readonly segment?: string;
}

/** A comparator, or field settings with an optional comparator. */
export type FieldRule = Comparator | FieldRuleOptions;

/**
 * How null, undefined and empty strings count. `absent` (default) treats all three as missing, and a null or
 * empty object or array as an absent container. `strict` keeps null as a value: a null leaf is compared, and a
 * null container, or an empty one where the other side has none, is scored as one field at the container's path.
 */
export type NullHandling = "absent" | "strict";

/** The rules of a spec, keyed by path pattern. */
export interface EvalRules {
  /** Comparator for strings no rule or annotation covers. Without it such strings are unresolved. */
  readonly strings?: Comparator;
  readonly nulls?: NullHandling;
  /** Named groups of leaves. When given, every leaf must fall in exactly one. A pattern also covers everything below it. */
  readonly segments?: Readonly<Record<string, string | readonly string[]>>;
  /**
   * Leaf rules. The most specific pattern wins: exact paths, then `*`, then `**`. An exact path naming an object or array compares it as one value.
   * An object whose schema allows unknown keys (`additionalProperties: true` or `{}`) needs a rule for them, such as `"meta.*"`,
   * or a rule comparing the whole object; otherwise `defineEval` reports it. A missing `additionalProperties` counts as closed,
   * since Zod and most generators omit it on ordinary objects.
   */
  readonly fields?: Readonly<Record<string, FieldRule>>;
  /**
   * Alignment rules for arrays, keyed by array pattern. Every array of rows needs one. `ordered` and `hungarian` pair rows by
   * similarity over every row field, nested arrays included, so a row needs at least one weighted field with a synchronous comparator.
   */
  readonly arrays?: Readonly<Record<string, ArrayRule>>;
  readonly assertions?: readonly Assertion[];
}

/** Where a resolved field got its comparator. */
export type FieldSource =
  | { readonly kind: "rule"; readonly rule: string }
  | { readonly kind: "annotation" }
  | { readonly kind: "type-default" }
  | { readonly kind: "strings" }
  | { readonly kind: "loose" };

/** One leaf of the spec with everything that decides how it is scored. */
export interface ResolvedField {
  readonly pattern: string;
  readonly type: FieldType;
  readonly comparator: Comparator;
  readonly segment: string;
  readonly weight: number;
  readonly critical: boolean;
  readonly source: FieldSource;
}

/** One array of the spec and its alignment rule. */
export interface ResolvedArray {
  readonly pattern: string;
  readonly rule: ArrayRule;
  readonly source: FieldSource;
}

/** A resolved field in serializable form, stored in every result. */
export interface ResolvedFieldInfo {
  readonly pattern: string;
  readonly type: FieldType;
  /** Comparator with options, such as `number(abs 0.01)`. */
  readonly comparator: string;
  readonly comparatorId: string;
  readonly options?: JsonValue;
  readonly segment: string;
  readonly weight: number;
  readonly critical: boolean;
  /** Such as `rule 'totals.*'`, `annotation` or `type default`. */
  readonly source: string;
}

/** A spec in serializable form. */
export interface SpecInfo {
  readonly fingerprint: string;
  readonly fields: readonly ResolvedFieldInfo[];
  readonly arrays: readonly { readonly pattern: string; readonly rule: string; readonly source: string }[];
}

/** Optional signals scored alongside a case's output. */
export interface ScoreExtras {
  /** Confidence in 0 to 1 keyed by concrete actual path. */
  readonly confidence?: Readonly<Record<string, number>>;
  readonly evidence?: readonly FieldEvidence[];
  readonly locations?: EvalCase["locations"];
}

/** The outcome of strict ground-truth validation. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly GroundTruthIssue[] };

/** How to compare values of type `T`. A plain object with methods, so the CLI can call a spec built by another installed copy. */
export interface EvalSpec<T = unknown> {
  /** Hash of everything that changes validation or scoring: types, enum values, nullability, comparators, alignment, segments, weights, null handling and assertion options. Property order does not count. */
  readonly fingerprint: string;
  readonly fields: readonly ResolvedField[];
  readonly arrays: readonly ResolvedArray[];
  readonly info: SpecInfo;
  /** Strict check of ground truth: unknown keys, wrong leaf types, rows with every field absent, invalid values and failed assertions. */
  validate(expected: unknown): ValidationResult<T>;
  /** Score one output. Throws when the spec holds an async comparator. */
  score(expected: T, actual: unknown, extras?: ScoreExtras): CaseScore;
  scoreAsync(expected: T, actual: unknown, extras?: ScoreExtras): Promise<CaseScore>;
  /** Why a path is scored the way it is, such as `lineItems[].amount: number(abs 0.01) from rule 'totals.*'`. */
  explain(path: string): string;
}
