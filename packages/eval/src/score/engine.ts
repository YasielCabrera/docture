import { alignRows, type Alignment, type AlignmentReport, type RowView } from "../align/align.js";
import { anlsSimilarity, normalizeText } from "../compare/strings.js";
import { compareSync, type CompareContext, type Comparison } from "../compare/types.js";
import type { FieldEvidence } from "../extractor.js";
import { canonicalJson, isPlainObject, toJsonValue } from "../json.js";
import { indexPath, keyPath } from "../path.js";
import type { PresenceField, RowLeaf, SpecNode } from "../spec/tree.js";
import type { NullHandling, ResolvedField, ScoreExtras } from "../spec/types.js";
import type { Assertion, AssertionResult } from "./assertions.js";
import { isGrounded } from "./grounded.js";
import {
  prf,
  type CaseScore,
  type EvidenceRef,
  type FieldResult,
  type FieldStatus,
  type SegmentScore,
  type StatusCounts,
} from "./types.js";

type MutableCounts = { -readonly [K in keyof StatusCounts]: number };

type LeafJob = {
  readonly expected: unknown;
  readonly actual: unknown;
  readonly path: string;
  readonly actualPath: string;
} & ({ readonly field: ResolvedField; readonly decided?: FieldStatus } | { readonly field: PresenceField; readonly decided: FieldStatus });

export function isAbsent(value: unknown, nulls: NullHandling): boolean {
  if (value === undefined) return true;
  if (nulls === "strict") return false;
  return value === null || (typeof value === "string" && value.trim() === "");
}

/** Collects leaves and alignment reports while a walker traverses expected and actual values together. */
export class ScoreCollector {
  readonly jobs: LeafJob[] = [];
  readonly arrays: AlignmentReport[] = [];
  constructor(readonly nulls: NullHandling) {}

  presence(field: PresenceField, expected: unknown, actual: unknown, path: string, actualPath: string): void {
    const expectedAbsent = isAbsent(expected, this.nulls);
    const actualAbsent = isAbsent(actual, this.nulls);
    if (expectedAbsent && actualAbsent) return;
    const decided = expectedAbsent ? "hallucination" : actualAbsent ? "omission" : expected === actual ? "match" : "mismatch";
    this.jobs.push({ field, expected, actual, path, actualPath, decided });
  }

  leaf(field: ResolvedField, expected: unknown, actual: unknown, path: string, actualPath: string): void {
    const expectedAbsent = isAbsent(expected, this.nulls);
    const actualAbsent = isAbsent(actual, this.nulls);
    if (expectedAbsent && actualAbsent) return;
    let decided: FieldStatus | undefined;
    if (expectedAbsent) decided = "hallucination";
    else if (actualAbsent) decided = "omission";
    else if (expected === null || actual === null) decided = expected === actual ? "match" : "mismatch";
    this.jobs.push({ field, expected, actual, path, actualPath, ...(decided === undefined ? {} : { decided }) });
  }
}

function contextOf(job: LeafJob): CompareContext {
  return { path: job.path, pattern: job.field.pattern };
}

export function compareJobsSync(jobs: readonly LeafJob[]): (Comparison | undefined)[] {
  return jobs.map((job) =>
    job.decided === undefined ? compareSync(job.field.comparator, job.expected, job.actual, contextOf(job)) : undefined,
  );
}

export async function compareJobsAsync(jobs: readonly LeafJob[]): Promise<(Comparison | undefined)[]> {
  return Promise.all(
    jobs.map(async (job) =>
      job.decided === undefined ? job.field.comparator.compare(job.expected, job.actual, contextOf(job)) : undefined,
    ),
  );
}

function valueAt(row: unknown, keys: readonly string[]): unknown {
  let current = row;
  for (const key of keys) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

type Presence = "missing" | "null" | "empty" | "filled";

function presenceOf(value: unknown): Presence {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : "filled";
  return isPlainObject(value) && Object.keys(value).length === 0 ? "empty" : "filled";
}

function containerOutcomeWithNullsAsUndefined(
  expected: unknown,
  actual: unknown,
  nulls: NullHandling,
): { readonly scored: boolean; readonly expected: unknown; readonly actual: unknown } {
  if (nulls === "absent") return { scored: false, expected, actual };
  const e = presenceOf(expected);
  const a = presenceOf(actual);
  if (e === "null" || a === "null")
    return { scored: true, expected: e === "null" ? undefined : expected, actual: a === "null" ? undefined : actual };
  return { scored: (e === "empty" && a === "missing") || (e === "missing" && a === "empty"), expected, actual };
}

function leafSimilarity(field: ResolvedField, expected: unknown, actual: unknown, nulls: NullHandling, path: string): number | undefined {
  const expectedAbsent = isAbsent(expected, nulls);
  const actualAbsent = isAbsent(actual, nulls);
  if (expectedAbsent && actualAbsent) return undefined;
  if (expectedAbsent || actualAbsent) return 0;
  if (expected === null || actual === null) return expected === actual ? 1 : 0;
  if (field.comparator.async === true) return undefined;
  return compareSync(field.comparator, expected, actual, { path, pattern: field.pattern }).similarity;
}

interface Tally {
  score: number;
  weight: number;
}

function tally(
  node: SpecNode,
  expected: unknown,
  actual: unknown,
  nulls: NullHandling,
  path: string,
  weightOf: (field: ResolvedField) => number,
  into: Tally,
): void {
  if (node.kind === "leaf") {
    const weight = weightOf(node.field);
    const similarity = weight === 0 ? undefined : leafSimilarity(node.field, expected, actual, nulls, path);
    if (similarity === undefined) return;
    into.score += similarity * weight;
    into.weight += weight;
    return;
  }
  const container = containerOutcomeWithNullsAsUndefined(expected, actual, nulls);
  if (container.scored) {
    into.weight += node.presence.weight;
    if (presenceOf(expected) === presenceOf(actual)) into.score += node.presence.weight;
  }
  forEachChild(node, container.expected, container.actual, nulls, path, path, (child, e, a, childPath) =>
    tally(child, e, a, nulls, childPath, weightOf, into),
  );
}

function similarityOf(
  node: SpecNode,
  expected: unknown,
  actual: unknown,
  nulls: NullHandling,
  path: string,
  weightOf: (field: ResolvedField) => number,
): number {
  const into: Tally = { score: 0, weight: 0 };
  tally(node, expected, actual, nulls, path, weightOf, into);
  return into.weight === 0 ? 0 : into.score / into.weight;
}

function keyOf(row: unknown, keys: readonly (readonly string[])[], nulls: NullHandling): string | undefined {
  const parts: string[] = [];
  for (const path of keys) {
    const value = valueAt(row, path);
    if (isAbsent(value, nulls)) return undefined;
    parts.push(typeof value === "string" ? normalizeText(value) : canonicalJson(value));
  }
  return parts.join("\u0000");
}

function combine(values: readonly unknown[], nulls: NullHandling): unknown {
  const present = values.filter((value) => !isAbsent(value, nulls));
  if (present.length === 0) return undefined;
  if (present.every((value) => typeof value === "number")) return present.reduce<number>((sum, value) => sum + (value as number), 0);
  if (present.every((value) => typeof value === "string")) return present.join(" ");
  return present[0];
}

type ArrayNode = Extract<SpecNode, { kind: "array" }>;

function rowView(node: ArrayNode, expected: readonly unknown[], actual: readonly unknown[], nulls: NullHandling, path: string): RowView {
  const keys = node.keys;
  const weights = new Map(node.rowLeaves.map((leaf) => [leaf.field, leaf.weight]));
  const weightOf = (field: ResolvedField) => weights.get(field) ?? field.weight;
  const leaves = (values: (leaf: RowLeaf) => unknown, other: (leaf: RowLeaf) => unknown): number => {
    let total = 0;
    let weight = 0;
    for (const leaf of node.rowLeaves) {
      const similarity = leaf.weight === 0 ? undefined : leafSimilarity(leaf.field, values(leaf), other(leaf), nulls, path);
      if (similarity === undefined) continue;
      total += similarity * leaf.weight;
      weight += leaf.weight;
    }
    return weight === 0 ? 0 : total / weight;
  };
  return {
    expected: expected.length,
    actual: actual.length,
    similarity: (i, j) => similarityOf(node.items, expected[i], actual[j], nulls, path, weightOf),
    ...(keys === undefined
      ? {}
      : { key: (side: "expected" | "actual", index: number) => keyOf((side === "expected" ? expected : actual)[index], keys, nulls) }),
    combined: (rowsE, rowsA) =>
      leaves(
        (leaf) =>
          combine(
            rowsE.map((i) => valueAt(expected[i], leaf.keys)),
            nulls,
          ),
        (leaf) =>
          combine(
            rowsA.map((j) => valueAt(actual[j], leaf.keys)),
            nulls,
          ),
      ),
  };
}

type Visit = (node: SpecNode, expected: unknown, actual: unknown, path: string, actualPath: string) => void;

function forEachChild(
  node: Exclude<SpecNode, { kind: "leaf" }>,
  expected: unknown,
  actual: unknown,
  nulls: NullHandling,
  path: string,
  actualPath: string,
  visitChild: Visit,
  report?: (alignment: Alignment, expected: number, actual: number) => void,
): void {
  if (node.kind === "object") {
    const e = isPlainObject(expected) ? expected : undefined;
    const a = isPlainObject(actual) ? actual : undefined;
    for (const [key, child] of node.properties) visitChild(child, e?.[key], a?.[key], keyPath(path, key), keyPath(actualPath, key));
    if (node.additional !== undefined) {
      const keys = new Set([...Object.keys(e ?? {}), ...Object.keys(a ?? {})]);
      for (const key of keys) {
        if (!node.properties.has(key)) visitChild(node.additional, e?.[key], a?.[key], keyPath(path, key), keyPath(actualPath, key));
      }
    }
    return;
  }
  const e = Array.isArray(expected) ? expected : [];
  const a = Array.isArray(actual) ? actual : [];
  if (e.length === 0 && a.length === 0) return;
  const alignment = alignRows(node.rule, rowView(node, e, a, nulls, path));
  report?.(alignment, e.length, a.length);
  for (const [i, j] of alignment.pairs) visitChild(node.items, e[i], a[j], indexPath(path, i), indexPath(actualPath, j));
  for (const i of alignment.missing) visitChild(node.items, e[i], undefined, indexPath(path, i), indexPath(path, i));
  alignment.extra.forEach((j, k) => visitChild(node.items, undefined, a[j], indexPath(path, e.length + k), indexPath(actualPath, j)));
}

/** Walk the spec tree over expected and actual values, collecting leaves and aligning arrays. */
export function walkSpec(node: SpecNode, expected: unknown, actual: unknown, path: string, actualPath: string, out: ScoreCollector): void {
  if (node.kind === "leaf") {
    out.leaf(node.field, expected, actual, path, actualPath);
    return;
  }
  const container = containerOutcomeWithNullsAsUndefined(expected, actual, out.nulls);
  if (container.scored) out.presence(node.presence, expected, actual, path, actualPath);
  const report =
    node.kind === "array"
      ? (alignment: Alignment, expectedRows: number, actualRows: number) =>
          out.arrays.push({
            path,
            pattern: node.pattern,
            algorithm: alignment.algorithm,
            expected: expectedRows,
            actual: actualRows,
            matched: alignment.pairs.length,
            missing: alignment.missing.length,
            extra: alignment.extra.length,
            outOfOrder: alignment.outOfOrder,
            splits: alignment.splits,
            merges: alignment.merges,
          })
      : undefined;
  forEachChild(
    node,
    container.expected,
    container.actual,
    out.nulls,
    path,
    actualPath,
    (child, e, a, childPath, childActualPath) => walkSpec(child, e, a, childPath, childActualPath, out),
    report,
  );
}

function textOf(value: unknown): string {
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return canonicalJson(value);
}

function evidenceIndex(evidence: readonly FieldEvidence[] | undefined): Map<string, FieldEvidence[]> {
  const index = new Map<string, FieldEvidence[]>();
  for (const item of evidence ?? []) {
    const list = index.get(item.path);
    if (list === undefined) index.set(item.path, [item]);
    else list.push(item);
  }
  return index;
}

function emptyCounts(): MutableCounts {
  return { match: 0, mismatch: 0, omission: 0, hallucination: 0 };
}

/** Turn collected leaves and their comparisons into a case score. */
export function finishScore(
  collector: ScoreCollector,
  comparisons: readonly (Comparison | undefined)[],
  actual: unknown,
  assertions: readonly Assertion[],
  extras: ScoreExtras | undefined,
): CaseScore {
  const evidence = evidenceIndex(extras?.evidence);
  const grounding = extras?.locations !== undefined || extras?.evidence !== undefined;
  const counts = emptyCounts();
  const weighted = emptyCounts();
  const segments = new Map<string, { counts: MutableCounts; weighted: MutableCounts }>();
  let anlsTotal = 0;
  let anlsCount = 0;
  let critical = true;
  const fields = collector.jobs.map((job, index): FieldResult => {
    const comparison = comparisons[index];
    const status: FieldStatus = job.decided ?? (comparison?.match === true ? "match" : "mismatch");
    const { field } = job;
    counts[status] += 1;
    weighted[status] += field.weight;
    let segment = segments.get(field.segment);
    if (segment === undefined) segments.set(field.segment, (segment = { counts: emptyCounts(), weighted: emptyCounts() }));
    segment.counts[status] += 1;
    segment.weighted[status] += field.weight;
    if (field.critical && status !== "match") critical = false;
    if (status !== "hallucination") {
      anlsTotal += status === "omission" ? 0 : anlsSimilarity(textOf(job.expected), textOf(job.actual));
      anlsCount += 1;
    }
    const refs = (evidence.get(job.actualPath) ?? []).map(
      (item): EvidenceRef => ({
        pageNumber: item.pageNumber,
        ...(item.box === undefined ? {} : { box: item.box }),
        ...(item.status === undefined ? {} : { status: item.status }),
      }),
    );
    const confidence =
      extras?.confidence?.[job.actualPath] ?? evidence.get(job.actualPath)?.find((item) => item.confidence !== undefined)?.confidence;
    const locations = status === "hallucination" ? undefined : extras?.locations?.[job.path];
    const grounded =
      status === "hallucination" || locations === undefined || locations.length === 0
        ? null
        : isGrounded({ status, evidence: refs }, locations);
    const similarity = status === "match" || status === "mismatch" ? (comparison?.similarity ?? (status === "match" ? 1 : 0)) : 0;
    return {
      path: job.path,
      ...(job.actualPath === job.path ? {} : { actualPath: job.actualPath }),
      pattern: field.pattern,
      segment: field.segment,
      status,
      expected: toJsonValue(job.expected),
      actual: toJsonValue(job.actual),
      comparator: field.comparator.id,
      similarity,
      weight: field.weight,
      ...(field.critical ? { critical: true as const } : {}),
      ...(comparison?.hint === undefined || status === "match" ? {} : { hint: comparison.hint }),
      ...(comparison?.note === undefined || status === "match" ? {} : { note: comparison.note }),
      ...(confidence === undefined ? {} : { confidence }),
      ...(refs.length === 0 ? {} : { evidence: refs }),
      ...(locations === undefined || locations.length === 0 ? {} : { locations }),
      ...(grounding ? { grounded } : {}),
    };
  });
  const assertionResults = assertions.map((assertion): AssertionResult => ({ id: assertion.id, ...assertion.check(actual) }));
  const segmentScores: Record<string, SegmentScore> = {};
  for (const [name, segment] of segments)
    segmentScores[name] = { ...prf(segment.weighted), counts: segment.counts, weighted: segment.weighted };
  return {
    fields,
    arrays: collector.arrays,
    assertions: assertionResults,
    counts,
    weighted,
    metrics: {
      ...prf(weighted),
      exact: counts.mismatch === 0 && counts.omission === 0 && counts.hallucination === 0,
      anls: anlsCount === 0 ? null : anlsTotal / anlsCount,
      critical,
    },
    segments: segmentScores,
  };
}
