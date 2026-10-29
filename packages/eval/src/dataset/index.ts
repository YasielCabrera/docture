import { DatasetError, GroundTruthError, MigrationGuardError, PreflightError, type InvalidCaseTruth } from "../errors.js";
import { fingerprintOf } from "../hash.js";
import { compareCodeUnits } from "../order.js";
import { compileRule, formatPath, ruleMatches, type PathSegment, type PatternToken, type RulePattern } from "../path.js";
import { canonicalJson, toJsonValue } from "../json.js";
import type { Dataset, EvalCase, WritableDataset } from "../case.js";
import type { EvalExtractor } from "../extractor.js";
import type { EvalSpec } from "../spec/types.js";

/** Settings for a deterministic, nested stratified sample. */
export interface SampleOptions<T = unknown> {
  readonly size: number;
  readonly strata?: (item: EvalCase<T>) => string;
  readonly keepGroups?: boolean;
  readonly seed?: string;
}

/** Hash the content and metadata that determine whether a case can be resumed. */
export function caseFingerprint(item: EvalCase): string {
  return fingerprintOf({
    id: item.id,
    expected: item.expected,
    documents: item.documents.map((d) => ({ name: d.name, hash: d.hash ?? null })),
    tags: item.tags ?? {},
    params: item.params ?? {},
    group: item.group ?? null,
    locations: item.locations ?? null,
  });
}

/** Hash a dataset independently of its discovery order. */
export function datasetFingerprint(items: readonly EvalCase[]): string {
  return fingerprintOf(
    items.map((item) => [item.id, caseFingerprint(item)]).sort((a, b) => compareCodeUnits(canonicalJson(a), canonicalJson(b))),
  );
}

function rank(id: string, seed: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${seed}\0${id}`)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

/** Select a nested prefix by incremental largest remainder; whole groups can exceed `size`. */
export function sample<T>(items: readonly EvalCase<T>[], options: SampleOptions<T>): readonly EvalCase<T>[] {
  if (!Number.isSafeInteger(options.size) || options.size < 0) throw new DatasetError("Sample size must be a nonnegative integer.");
  const groups = new Map<string, EvalCase<T>[]>();
  for (const item of items) {
    const key = options.keepGroups && item.group !== undefined ? `group:${item.group}` : `case:${item.id}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const strata = new Map<string, { id: string; cases: EvalCase<T>[] }[]>();
  for (const [id, cases] of groups) {
    const first = cases[0];
    if (!first) continue;
    const key = options.strata?.(first) ?? "";
    const bucket = strata.get(key) ?? [];
    bucket.push({ id, cases });
    strata.set(key, bucket);
  }
  const buckets = [...strata]
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([, groups]) => ({
      groups: groups.sort((a, b) => rank(a.id, options.seed ?? "") - rank(b.id, options.seed ?? "") || compareCodeUnits(a.id, b.id)),
      taken: 0,
    }));
  const selected = new Set<string>();
  let count = 0;
  for (let seat = 1; count < Math.min(options.size, items.length); seat++) {
    const next = buckets
      .filter((b) => b.taken < b.groups.length)
      .sort((a, b) => (b.groups.length * seat) / groups.size - b.taken - ((a.groups.length * seat) / groups.size - a.taken))[0];
    if (!next) break;
    const group = next.groups[next.taken++];
    if (!group) break;
    for (const item of group.cases) {
      selected.add(item.id);
      count++;
    }
  }
  return items.filter((item) => selected.has(item.id));
}

/** A guarded, idempotent ground-truth transformation. */
export interface Migration<T> {
  readonly id: string;
  readonly description: string;
  /** Paths or patterns the migration may change, such as `totals.net` or `lineItems[].amount`. A target also covers everything below it. */
  readonly targets: readonly string[];
  apply(expected: T, item: EvalCase<T>): T;
}
/** One changed leaf of a migration. */
export interface MigrationDiff {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}
/** Per-case migration changes, including whether they were written. */
export interface MigrationReport {
  readonly migration: string;
  readonly written: boolean;
  readonly cases: readonly { readonly caseId: string; readonly diff: readonly MigrationDiff[] }[];
}
/** Define the paths and transformation of a migration. */
export function defineMigration<T>(migration: Migration<T>): Migration<T> {
  return migration;
}
interface Change extends MigrationDiff {
  readonly segments: readonly PathSegment[];
}
function diff(before: unknown, after: unknown, segments: readonly PathSegment[] = []): Change[] {
  if ((before === undefined) === (after === undefined) && canonicalJson(before) === canonicalJson(after)) return [];
  if (typeof before === "object" && before !== null && typeof after === "object" && after !== null) {
    const a = Object.fromEntries(Object.entries(before));
    const b = Object.fromEntries(Object.entries(after));
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      diff(a[key], b[key], [...segments, Array.isArray(before) ? Number(key) : key]),
    );
  }
  return [{ path: formatPath(segments), segments, before, after }];
}
function compileTargets(migration: Migration<unknown>): readonly RulePattern[] {
  const compiled = migration.targets.map((target) => ({ target, rule: compileRule(target) }));
  const invalid = compiled.flatMap(({ target, rule }) => (rule ? [] : [target]));
  if (invalid.length)
    throw new MigrationGuardError(migration.id, invalid, "Migration targets must be paths or patterns such as lineItems[].amount.");
  return compiled.flatMap(({ rule }) => (rule ? [rule] : []));
}
/** Preview every change and validate guards for every case, then optionally write. A draft case stays a draft. */
export async function runMigration<T>(
  dataset: WritableDataset<T>,
  migration: Migration<T>,
  options: { readonly write?: boolean; readonly spec?: EvalSpec<T> } = {},
): Promise<MigrationReport> {
  const targets = compileTargets(migration as Migration<unknown>);
  const targeted = (segments: readonly PathSegment[]): boolean => {
    const pattern: PatternToken[] = segments.map((segment) =>
      typeof segment === "number" ? { kind: "items" } : { kind: "key", key: segment },
    );
    return targets.some((rule) => ruleMatches(rule, pattern, true));
  };
  const invalidTruth: InvalidCaseTruth[] = [];
  const prepared = (await dataset.cases()).map((item) => {
    const before = structuredClone(item.expected);
    const after = migration.apply(structuredClone(before), item);
    const changes = diff(before, after);
    const outside = changes.filter((change) => !targeted(change.segments));
    if (outside.length)
      throw new MigrationGuardError(
        migration.id,
        outside.map((c) => c.path),
        "Migration changed an untargeted path.",
        { caseId: item.id },
      );
    if (canonicalJson(after) !== canonicalJson(migration.apply(structuredClone(after), item)))
      throw new MigrationGuardError(
        migration.id,
        changes.map((c) => c.path),
        "Migration is not idempotent.",
        { caseId: item.id },
      );
    const validation = options.spec?.validate(after);
    if (validation && !validation.ok) invalidTruth.push({ caseId: item.id, issues: validation.issues });
    return { item, after, diff: changes.map(({ path, before, after }) => ({ path, before, after })) };
  });
  if (invalidTruth.length) throw new GroundTruthError(invalidTruth);
  if (options.write)
    for (const { item, after, diff } of prepared)
      if (diff.length) await dataset.writeExpected(item.id, after, { draft: item.status === "draft" });
  return { migration: migration.id, written: options.write ?? false, cases: prepared.map((p) => ({ caseId: p.item.id, diff: p.diff })) };
}

/** A case whose documents exist but whose truth is not signed off yet. */
export type PendingCase = Omit<EvalCase, "expected" | "status">;
/** A writable dataset that also lists cases without signed-off truth, so {@link draftExpected} can reach cases that have none. */
export interface DraftableDataset<T = unknown> extends WritableDataset<T> {
  pendingCases(options?: { readonly signal?: AbortSignal }): Promise<readonly PendingCase[]>;
}
/**
 * Extract proposed truth for every case without signed-off truth and write it as a draft, replacing an
 * existing draft. Uses `pendingCases()` when the dataset has it, otherwise the cases whose status is `draft`.
 * Returns the drafted case ids.
 */
export async function draftExpected<T>(
  dataset: WritableDataset<T> & Partial<Pick<DraftableDataset<T>, "pendingCases">>,
  processor: EvalExtractor<unknown, T>,
): Promise<readonly string[]> {
  const signal = new AbortController().signal;
  try {
    const pending: readonly PendingCase[] = dataset.pendingCases
      ? await dataset.pendingCases()
      : (await dataset.cases()).filter((item) => item.status === "draft");
    if (!pending.length) return [];
    try {
      await processor.preflight?.({ signal });
    } catch (error) {
      throw new PreflightError(processor.id, error);
    }
    const drafted: string[] = [];
    for (const item of pending) {
      const output = await processor.extract({ ...item, expected: undefined }, { signal, epoch: 0, experiment: processor.id });
      const value = processor.project ? processor.project(output.raw) : (toJsonValue(output.raw) as T);
      await dataset.writeExpected(item.id, value, { draft: true });
      drafted.push(item.id);
    }
    return drafted;
  } finally {
    await processor.dispose?.();
  }
}
