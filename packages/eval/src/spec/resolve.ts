import type { ArrayRule } from "../align/rules.js";
import { date } from "../compare/date.js";
import { exact } from "../compare/exact.js";
import { number } from "../compare/number.js";
import type { Comparator } from "../compare/types.js";
import type { SpecProblem } from "../errors.js";
import { isPlainObject, type JsonValue } from "../json.js";
import {
  compileRule,
  formatPath,
  formatPattern,
  parsePathText,
  patternOf,
  ruleMatches,
  type PatternToken,
  type RulePattern,
} from "../path.js";
import { parseAnnotation, type Annotation } from "./annotation.js";
import type { SchemaNode } from "./schema-tree.js";
import type { PresenceField, RowLeaf, SpecNode } from "./tree.js";
import type { EvalRules, FieldRuleOptions, FieldSource, FieldType, ResolvedArray, ResolvedField } from "./types.js";

interface Compiled<V> {
  readonly key: string;
  readonly pattern: RulePattern;
  readonly value: V;
  used: boolean;
}

interface Context {
  readonly rules: EvalRules;
  readonly presence: PresenceField["comparator"];
  readonly problems: SpecProblem[];
  readonly fieldRules: Compiled<FieldRuleOptions>[];
  readonly arrayRules: Compiled<ArrayRule>[];
  readonly segments: Compiled<string>[];
  readonly declaredSegments: ReadonlySet<string>;
  readonly fields: ResolvedField[];
  readonly arrays: ResolvedArray[];
  readonly known: Set<string>;
}

/** The resolved tree with its flat views. */
export interface Resolution {
  readonly tree: SpecNode;
  readonly fields: readonly ResolvedField[];
  readonly arrays: readonly ResolvedArray[];
}

export function isComparator(value: unknown): value is Comparator {
  return (
    typeof value === "object" &&
    value !== null &&
    "compare" in value &&
    typeof value.compare === "function" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

const RULE_KEYS = new Set(["compare", "weight", "critical", "segment"]);

function fieldRuleOptions(key: string, raw: unknown, problems: SpecProblem[]): FieldRuleOptions | undefined {
  if (isComparator(raw)) return { compare: raw };
  if (!isPlainObject(raw)) {
    problems.push({
      code: "invalid-rule",
      path: key,
      message: "a field rule must be a comparator or { compare, weight, critical, segment }",
    });
    return undefined;
  }
  const issues: string[] = [];
  for (const name of Object.keys(raw)) if (!RULE_KEYS.has(name)) issues.push(`unknown setting ${name}`);
  if (raw.compare !== undefined && !isComparator(raw.compare)) issues.push("compare must be a comparator");
  if (raw.weight !== undefined && !(typeof raw.weight === "number" && Number.isFinite(raw.weight) && raw.weight >= 0))
    issues.push("weight must be a finite number of at least 0");
  if (raw.critical !== undefined && typeof raw.critical !== "boolean") issues.push("critical must be a boolean");
  if (raw.segment !== undefined && typeof raw.segment !== "string") issues.push("segment must be a string");
  if (issues.length > 0) {
    problems.push({ code: "invalid-rule", path: key, message: issues.join("; ") });
    return undefined;
  }
  return raw as FieldRuleOptions;
}

function isArrayRule(value: unknown): value is ArrayRule {
  return isPlainObject(value) && (value.kind === "index" || value.kind === "ordered" || value.kind === "hungarian");
}

function compile<V>(entries: readonly (readonly [string, V])[], problems: SpecProblem[], label: string): Compiled<V>[] {
  const out: Compiled<V>[] = [];
  for (const [key, value] of entries) {
    const pattern = compileRule(key);
    if (pattern === undefined) problems.push({ code: "invalid-rule", path: key, message: `not a ${label} pattern` });
    else out.push({ key, pattern, value, used: false });
  }
  return out;
}

function pick<V>(
  rules: Compiled<V>[],
  tokens: readonly PatternToken[],
  ctx: Context,
  exactOnly = false,
): Compiled<V> | "ambiguous" | undefined {
  const matches = rules.filter((rule) => (!exactOnly || rule.pattern.specificity === 0) && ruleMatches(rule.pattern, tokens));
  if (matches.length === 0) return undefined;
  for (const rule of matches) rule.used = true;
  const best = Math.min(...matches.map((rule) => rule.pattern.specificity));
  const top = matches.filter((rule) => rule.pattern.specificity === best);
  if (top.length > 1) {
    ctx.problems.push({
      code: "ambiguous-rule",
      path: formatPattern(tokens),
      message: `rules ${top.map((rule) => `'${rule.key}'`).join(" and ")} are equally specific`,
    });
    return "ambiguous";
  }
  return top[0];
}

function annotationOf(node: SchemaNode, pattern: string, ctx: Context): Annotation | undefined {
  if (node.annotation === undefined) return undefined;
  try {
    return parseAnnotation(node.annotation);
  } catch (error) {
    ctx.problems.push({ code: "invalid-annotation", path: pattern, message: `x-docture-eval: ${(error as Error).message}` });
    return undefined;
  }
}

function typeDefault(type: FieldType): Comparator | undefined {
  switch (type) {
    case "number":
      return number({ abs: 0 });
    case "integer":
    case "boolean":
    case "enum":
      return exact();
    case "date":
      return date({ granularity: "day" });
    case "date-time":
      return date({ granularity: "instant" });
    default:
      return undefined;
  }
}

function segmentOf(tokens: readonly PatternToken[], explicit: string | undefined, ctx: Context): string | undefined {
  const pattern = formatPattern(tokens);
  if (explicit !== undefined) {
    if (ctx.declaredSegments.size > 0 && !ctx.declaredSegments.has(explicit)) {
      ctx.problems.push({ code: "invalid-rule", path: pattern, message: `segment "${explicit}" is not declared in segments` });
      return undefined;
    }
    return explicit;
  }
  if (ctx.declaredSegments.size === 0) return "all";
  const names = new Set<string>();
  for (const segment of ctx.segments) {
    if (ruleMatches(segment.pattern, tokens, true)) {
      segment.used = true;
      names.add(segment.value);
    }
  }
  if (names.size === 1) return [...names][0];
  ctx.problems.push(
    names.size === 0
      ? { code: "unsegmented-field", path: pattern, message: "this field is in no declared segment" }
      : { code: "overlapping-segments", path: pattern, message: `this field is in segments ${[...names].join(" and ")}` },
  );
  return undefined;
}

function leaf(
  type: FieldType,
  nullable: boolean,
  values: readonly JsonValue[] | undefined,
  tokens: readonly PatternToken[],
  annotation: Annotation | undefined,
  rule: Compiled<FieldRuleOptions> | undefined,
  ctx: Context,
): SpecNode | undefined {
  const pattern = formatPattern(tokens);
  let comparator: Comparator | undefined;
  let source: FieldSource | undefined;
  if (rule?.value.compare !== undefined) {
    comparator = rule.value.compare;
    source = { kind: "rule", rule: rule.key };
  } else if (annotation?.comparator !== undefined) {
    comparator = annotation.comparator;
    source = { kind: "annotation" };
  } else if ((comparator = typeDefault(type)) !== undefined) {
    source = { kind: "type-default" };
  } else if (type === "string" && ctx.rules.strings !== undefined) {
    comparator = ctx.rules.strings;
    source = { kind: "strings" };
  }
  const segment = segmentOf(tokens, rule?.value.segment ?? annotation?.segment, ctx);
  if (comparator === undefined || source === undefined) {
    ctx.problems.push({
      code: "unresolved-field",
      path: pattern,
      message:
        type === "string"
          ? "no comparator for this string; add a fields rule, an x-docture-eval annotation or a strings default such as text({ minSimilarity: 0.9 })"
          : `no comparator for this ${type} value; add a fields rule or an x-docture-eval annotation`,
    });
    return undefined;
  }
  if (segment === undefined) return undefined;
  const field: ResolvedField = {
    pattern,
    type,
    comparator,
    segment,
    weight: rule?.value.weight ?? annotation?.weight ?? 1,
    critical: rule?.value.critical ?? annotation?.critical ?? false,
    source,
  };
  ctx.fields.push(field);
  return { kind: "leaf", field, shape: { type, nullable, ...(values === undefined ? {} : { values }) } };
}

function rowLeaves(items: SpecNode, rule: ArrayRule, pattern: string, ctx: Context): RowLeaf[] {
  const out: RowLeaf[] = [];
  const visit = (node: SpecNode, keys: readonly string[]): void => {
    if (node.kind === "leaf") {
      const relative = formatPath(keys);
      const weight = rule.kind === "hungarian" ? rule.weights?.[relative] : undefined;
      out.push({ field: node.field, keys, weight: weight ?? node.field.weight });
    } else if (node.kind === "object") {
      for (const [key, child] of node.properties) visit(child, [...keys, key]);
    }
  };
  visit(items, []);
  if (rule.kind === "hungarian") {
    const relatives = new Set(out.map((row) => formatPath(row.keys)));
    for (const name of Object.keys(rule.weights ?? {})) {
      if (!relatives.has(name))
        ctx.problems.push({ code: "invalid-rule", path: pattern, message: `weight for ${name} names no field of the row` });
    }
  }
  return out;
}

function keyPaths(rule: ArrayRule, rows: readonly RowLeaf[], pattern: string, ctx: Context): (readonly string[])[] | undefined {
  if (rule.kind !== "hungarian" || rule.key === undefined) return undefined;
  const byPath = new Map(rows.map((row) => [formatPath(row.keys), row.keys]));
  const out: (readonly string[])[] = [];
  for (const name of rule.key) {
    const tokens = parsePathText(name);
    const keys =
      tokens !== undefined && tokens.every((token) => token.kind === "key")
        ? byPath.get(formatPath(tokens.map((token) => token.key)))
        : undefined;
    if (keys === undefined) ctx.problems.push({ code: "invalid-rule", path: pattern, message: `key ${name} names no field of the row` });
    else out.push(keys);
  }
  return out;
}

function presenceField(pattern: string, type: "object" | "array", leaves: readonly ResolvedField[], ctx: Context): PresenceField {
  const segments = new Set(leaves.map((field) => field.segment));
  const segment = segments.size === 1 ? [...segments][0]! : (leaves[0]?.segment ?? "all");
  return { pattern, type, comparator: ctx.presence, segment, weight: 1, critical: false, source: { kind: "type-default" } };
}

function alignable(node: SpecNode, weightOf: (field: ResolvedField) => number): boolean {
  switch (node.kind) {
    case "leaf":
      return weightOf(node.field) > 0 && node.field.comparator.async !== true;
    case "object":
      return (
        [...node.properties.values()].some((child) => alignable(child, weightOf)) ||
        (node.additional !== undefined && alignable(node.additional, weightOf))
      );
    case "array":
      return alignable(node.items, weightOf);
  }
}

const UNKNOWN_VALUE: SchemaNode = { kind: "leaf", type: "unknown", nullable: true };

function openKeys(tokens: readonly PatternToken[], ctx: Context): SpecNode | undefined {
  const anyKey: PatternToken[] = [...tokens, { kind: "any-key" }];
  if (ctx.fieldRules.some((rule) => ruleMatches(rule.pattern, anyKey))) return visit(UNKNOWN_VALUE, anyKey, ctx);
  const pattern = formatPattern(tokens);
  ctx.problems.push({
    code: "open-object",
    path: pattern,
    message: `this object allows keys the schema does not name; add a rule '${formatPattern(anyKey)}' to compare them, ${pattern === "" ? "" : `compare the object as one value with a rule for '${pattern}', `}or close it with additionalProperties: false`,
  });
  return undefined;
}

function visit(schema: SchemaNode, tokens: readonly PatternToken[], ctx: Context): SpecNode | undefined {
  const pattern = formatPattern(tokens);
  ctx.known.add(pattern);
  const annotation = annotationOf(schema, pattern, ctx);
  if (schema.kind === "leaf") {
    const rule = pick(ctx.fieldRules, tokens, ctx);
    if (rule === "ambiguous") return undefined;
    return leaf(schema.type === "null" ? "unknown" : schema.type, schema.nullable, schema.values, tokens, annotation, rule, ctx);
  }
  const whole = pick(ctx.fieldRules, tokens, ctx, true);
  if (whole === "ambiguous") return undefined;
  if (whole !== undefined || annotation?.comparator !== undefined) {
    if (whole !== undefined && whole.value.compare === undefined && annotation?.comparator === undefined) {
      ctx.problems.push({
        code: "invalid-rule",
        path: whole.key,
        message: `rule names an ${schema.kind}; give it a comparator to compare it as one value, or write '${whole.key}.**'`,
      });
      return undefined;
    }
    return leaf(schema.kind, schema.nullable, undefined, tokens, annotation, whole, ctx);
  }
  const first = ctx.fields.length;
  if (schema.kind === "object") {
    const properties = new Map<string, SpecNode>();
    let complete = true;
    for (const [key, child] of schema.properties) {
      const resolved = visit(child, [...tokens, { kind: "key", key }], ctx);
      if (resolved === undefined) complete = false;
      else properties.set(key, resolved);
    }
    const additional =
      schema.additional !== undefined
        ? visit(schema.additional, [...tokens, { kind: "any-key" }], ctx)
        : schema.open
          ? openKeys(tokens, ctx)
          : undefined;
    if (!complete || ((schema.additional !== undefined || schema.open) && additional === undefined)) return undefined;
    return {
      kind: "object",
      pattern,
      properties,
      nullable: schema.nullable,
      presence: presenceField(pattern, "object", ctx.fields.slice(first), ctx),
      ...(additional === undefined ? {} : { additional }),
    };
  }
  const chosen = pick(ctx.arrayRules, tokens, ctx);
  const items = visit(schema.items, [...tokens, { kind: "items" }], ctx);
  if (chosen === "ambiguous") return undefined;
  const rule = chosen?.value ?? annotation?.align;
  if (rule === undefined) {
    ctx.problems.push({
      code: "unresolved-array",
      path: pattern,
      message: `no alignment rule for this array; add arrays: { "${pattern}": hungarian(...) } or byIndex(), or an x-docture-eval align annotation`,
    });
    return undefined;
  }
  ctx.arrays.push({ pattern, rule, source: chosen === undefined ? { kind: "annotation" } : { kind: "rule", rule: chosen.key } });
  if (items === undefined) return undefined;
  const rows = rowLeaves(items, rule, pattern, ctx);
  const keys = keyPaths(rule, rows, pattern, ctx);
  const weights = new Map(rows.map((row) => [row.field, row.weight]));
  if (rule.kind !== "index" && !alignable(items, (field) => weights.get(field) ?? field.weight)) {
    ctx.problems.push({
      code: "unalignable-array",
      path: pattern,
      message:
        "rows have no field with a synchronous comparator and a weight above 0, so alignment cannot pair them by content; use byIndex() or give a row field a synchronous comparator",
    });
  }
  return {
    kind: "array",
    pattern,
    items,
    rule,
    rowLeaves: rows,
    nullable: schema.nullable,
    presence: presenceField(pattern, "array", ctx.fields.slice(first), ctx),
    ...(keys === undefined ? {} : { keys }),
  };
}

/** Resolve a schema tree against rules. Problems are appended; the tree is `undefined` when any field failed to resolve. */
export function resolveSpec(schema: SchemaNode, rules: EvalRules, problems: SpecProblem[]): Resolution | undefined {
  const fieldEntries: [string, FieldRuleOptions][] = [];
  for (const [key, raw] of Object.entries(rules.fields ?? {})) {
    const options = fieldRuleOptions(key, raw, problems);
    if (options !== undefined) fieldEntries.push([key, options]);
  }
  const arrayEntries: [string, ArrayRule][] = [];
  for (const [key, raw] of Object.entries(rules.arrays ?? {})) {
    if (isArrayRule(raw)) arrayEntries.push([key, raw]);
    else problems.push({ code: "invalid-rule", path: key, message: "an array rule must come from byIndex(), ordered() or hungarian()" });
  }
  const segmentEntries = Object.entries(rules.segments ?? {}).flatMap(([name, patterns]) =>
    (typeof patterns === "string" ? [patterns] : patterns).map((pattern) => [pattern, name] as const),
  );
  if (rules.strings !== undefined && !isComparator(rules.strings))
    problems.push({ code: "invalid-rule", path: "strings", message: "strings must be a comparator" });
  if (rules.nulls !== undefined && rules.nulls !== "absent" && rules.nulls !== "strict")
    problems.push({ code: "invalid-rule", path: "nulls", message: 'nulls must be "absent" or "strict"' });
  const ctx: Context = {
    rules,
    presence: { id: "exact" },
    problems,
    fieldRules: compile(fieldEntries, problems, "field"),
    arrayRules: compile(arrayEntries, problems, "array"),
    segments: compile(segmentEntries, problems, "segment"),
    declaredSegments: new Set(Object.keys(rules.segments ?? {})),
    fields: [],
    arrays: [],
    known: new Set(),
  };
  const tree = visit(schema, [], ctx);
  for (const rule of ctx.fieldRules)
    if (!rule.used) problems.push({ code: "unmatched-rule", path: rule.key, message: "this field rule matches no schema path" });
  for (const rule of ctx.arrayRules)
    if (!rule.used) problems.push({ code: "unmatched-rule", path: rule.key, message: "this array rule matches no array in the schema" });
  for (const segment of ctx.segments)
    if (!segment.used)
      problems.push({ code: "unmatched-rule", path: segment.key, message: `segment ${segment.value} pattern matches no schema path` });
  for (const assertion of rules.assertions ?? []) {
    for (const path of assertion.paths ?? []) {
      if (!ctx.known.has(patternOf(path)))
        problems.push({ code: "unknown-path", path, message: `assertion ${assertion.id} reads a path the schema does not have` });
    }
  }
  return tree === undefined ? undefined : { tree, fields: ctx.fields, arrays: ctx.arrays };
}
