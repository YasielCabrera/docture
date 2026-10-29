import type { ContractLike, InferContract } from "docture";
import { describeArrayRule } from "../align/rules.js";
import { describeComparator } from "../compare/types.js";
import { EvalSpecError, type GroundTruthIssue, type SpecProblem } from "../errors.js";
import { fingerprintOf } from "../hash.js";
import { canonicalJson, type JsonValue } from "../json.js";
import { parsePathText } from "../path.js";
import type { Assertion } from "../score/assertions.js";
import { ScoreCollector, compareJobsAsync, compareJobsSync, finishScore, walkSpec } from "../score/engine.js";
import { resolveSpec } from "./resolve.js";
import { jsonSchemaOf, type JsonSchemaObject, type SchemaInput } from "./schema-source.js";
import { schemaTree } from "./schema-tree.js";
import type { SpecNode } from "./tree.js";
import type {
  EvalRules,
  EvalSpec,
  FieldSource,
  NullHandling,
  ResolvedArray,
  ResolvedField,
  ResolvedFieldInfo,
  SpecInfo,
  ValidationResult,
} from "./types.js";
import { validateTree } from "./validate.js";

export function sourceText(source: FieldSource, field?: Pick<ResolvedField, "type">): string {
  switch (source.kind) {
    case "rule":
      return `rule '${source.rule}'`;
    case "annotation":
      return "x-docture-eval annotation";
    case "type-default":
      return `type default (${field?.type ?? "value"})`;
    case "strings":
      return "the strings default";
    case "loose":
      return "looseEval defaults";
  }
}

export function fieldInfo(field: ResolvedField): ResolvedFieldInfo {
  return {
    pattern: field.pattern,
    type: field.type,
    comparator: describeComparator(field.comparator),
    comparatorId: field.comparator.id,
    ...(field.comparator.options === undefined ? {} : { options: field.comparator.options }),
    segment: field.segment,
    weight: field.weight,
    critical: field.critical,
    source: sourceText(field.source, field),
  };
}

/** What a concrete spec contributes; the shared shell adds scoring. */
export interface SpecParts<T> {
  readonly fingerprint: string;
  readonly fields: readonly ResolvedField[];
  readonly arrays: readonly ResolvedArray[];
  readonly nulls: NullHandling;
  readonly assertions: readonly Assertion[];
  collect(expected: unknown, actual: unknown): ScoreCollector;
  validate(expected: unknown): ValidationResult<T>;
  explain(path: string): string;
}

export function assembleSpec<T>(parts: SpecParts<T>): EvalSpec<T> {
  const asyncField = parts.fields.find((field) => field.comparator.async === true);
  const info: SpecInfo = {
    fingerprint: parts.fingerprint,
    fields: parts.fields.map(fieldInfo),
    arrays: parts.arrays.map((array) => ({
      pattern: array.pattern,
      rule: describeArrayRule(array.rule).text,
      source: sourceText(array.source),
    })),
  };
  return {
    fingerprint: parts.fingerprint,
    fields: parts.fields,
    arrays: parts.arrays,
    info,
    validate: parts.validate,
    explain: parts.explain,
    score(expected, actual, extras) {
      if (asyncField !== undefined) {
        throw new TypeError(`${asyncField.pattern} uses the async comparator ${asyncField.comparator.id}; call spec.scoreAsync instead.`);
      }
      const collector = parts.collect(expected, actual);
      return finishScore(collector, compareJobsSync(collector.jobs), actual, parts.assertions, extras);
    },
    async scoreAsync(expected, actual, extras) {
      const collector = parts.collect(expected, actual);
      return finishScore(collector, await compareJobsAsync(collector.jobs), actual, parts.assertions, extras);
    },
  };
}

function canonicalNodeDescription(node: SpecNode): JsonValue {
  switch (node.kind) {
    case "leaf": {
      const { field, shape } = node;
      return {
        type: shape.type,
        nullable: shape.nullable,
        values: shape.values === undefined ? null : shape.values.map(canonicalJson).sort(),
        comparator: field.comparator.id,
        options: field.comparator.options ?? null,
        segment: field.segment,
        weight: field.weight,
        critical: field.critical,
      };
    }
    case "object":
      return {
        kind: "object",
        nullable: node.nullable,
        properties: Object.fromEntries([...node.properties].map(([key, child]) => [key, canonicalNodeDescription(child)])),
        additional: node.additional === undefined ? null : canonicalNodeDescription(node.additional),
      };
    case "array":
      return {
        kind: "array",
        nullable: node.nullable,
        rule: describeArrayRule(node.rule).json,
        items: canonicalNodeDescription(node.items),
      };
  }
}

function findNode(tree: SpecNode, path: string): SpecNode | undefined {
  const tokens = parsePathText(path);
  if (tokens === undefined) return undefined;
  let node: SpecNode | undefined = tree;
  for (const token of tokens) {
    if (node === undefined) return undefined;
    if (token.kind === "key") node = node.kind === "object" ? (node.properties.get(token.key) ?? node.additional) : undefined;
    else node = node.kind === "array" ? node.items : undefined;
  }
  return node;
}

function explainNode(tree: SpecNode, arrays: readonly ResolvedArray[], path: string): string {
  const node = findNode(tree, path);
  if (node === undefined) return `${path}: not a path of this spec`;
  switch (node.kind) {
    case "leaf": {
      const { field } = node;
      const extras = [
        ...(field.weight === 1 ? [] : [`weight ${field.weight}`]),
        ...(field.critical ? ["critical"] : []),
        ...(field.segment === "all" ? [] : [`segment ${field.segment}`]),
      ];
      return `${field.pattern}: ${describeComparator(field.comparator)} from ${sourceText(field.source, field)}${extras.length === 0 ? "" : `; ${extras.join("; ")}`}`;
    }
    case "array": {
      const source = arrays.find((array) => array.pattern === node.pattern)?.source;
      return `${node.pattern}: ${describeArrayRule(node.rule).text}${source === undefined ? "" : ` from ${sourceText(source)}`}`;
    }
    case "object":
      return `${node.pattern === "" ? "(root)" : node.pattern}: object with ${[...node.properties.keys()].join(", ")}`;
  }
}

/**
 * Build a spec from a schema and rules. Every leaf gets its comparator from, in
 * order: the most specific `fields` rule, an `x-docture-eval` annotation, an
 * unambiguous type default, or `strings` for strings. Unresolved fields, unused
 * rules and unsegmented leaves throw one {@link EvalSpecError} listing them all.
 *
 * @example
 * ```ts
 * const spec = defineEval(Invoice, {
 *   strings: text({ minSimilarity: 0.9 }),
 *   fields: { "totals.*": number({ abs: 0.01 }), iban: identifier() },
 *   arrays: { lineItems: hungarian({ key: ["sku"] }) },
 * });
 * ```
 */
export function defineEval<C extends ContractLike>(schema: C, rules?: EvalRules): EvalSpec<InferContract<C>>;
export function defineEval<T = unknown>(schema: JsonSchemaObject, rules?: EvalRules): EvalSpec<T>;
export function defineEval(schema: SchemaInput, rules: EvalRules = {}): EvalSpec<unknown> {
  const problems: SpecProblem[] = [];
  if (typeof rules !== "object" || rules === null)
    throw new EvalSpecError([{ code: "invalid-rule", path: "", message: "rules must be an object" }]);
  let source;
  try {
    source = jsonSchemaOf(schema);
  } catch (error) {
    source = { ok: false as const, message: `reading the JSON Schema failed: ${(error as Error).message}` };
  }
  if (!source.ok) throw new EvalSpecError([{ code: "unsupported-schema", path: "", message: source.message }]);
  const resolution = resolveSpec(schemaTree(source.schema, problems), rules, problems);
  if (problems.length > 0 || resolution === undefined) throw new EvalSpecError(problems);
  const nulls = rules.nulls ?? "absent";
  const assertions = rules.assertions ?? [];
  const { tree, fields, arrays } = resolution;
  const fingerprint = fingerprintOf({
    kind: "spec",
    nulls,
    tree: canonicalNodeDescription(tree),
    assertions: assertions
      .map((assertion) => canonicalJson({ id: assertion.id, paths: assertion.paths ?? [], options: assertion.options ?? null }))
      .sort(),
  });
  return assembleSpec({
    fingerprint,
    fields,
    arrays,
    nulls,
    assertions,
    collect(expected, actual) {
      const collector = new ScoreCollector(nulls);
      walkSpec(tree, expected, actual, "", "", collector);
      return collector;
    },
    validate(expected) {
      const issues: GroundTruthIssue[] = validateTree(tree, expected, nulls, assertions);
      return issues.length === 0 ? { ok: true, value: expected } : { ok: false, issues };
    },
    explain: (path) => explainNode(tree, arrays, path),
  });
}
