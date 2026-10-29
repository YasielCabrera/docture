import type { TagValue } from "../case.js";
import { isFallback } from "../align/align.js";
import { EvalSpecError } from "../errors.js";
import type { GateResult } from "../gate/types.js";
import type { JsonValue } from "../json.js";
import { builtinMetrics, prfValues, runScopeOmissions } from "../metrics/builtin.js";
import type { MetricContext, MetricDefinition } from "../metrics/types.js";
import { ZERO_COUNTS, addCounts, prf, type StatusCounts } from "../score/types.js";
import { sliceValues, type SliceSpec } from "../slices.js";
import type { CalibrationReport, GroundingReport, RunComparison } from "./sections.js";
import {
  RESULT_FORMAT,
  RESULT_VERSION,
  type CaseResult,
  type EpochSummary,
  type EvalResult,
  type FieldGroupSummary,
  type MetricValues,
  type RunInfo,
  type Summary,
} from "./types.js";

/** Everything `buildResult` assembles into an {@link EvalResult}. */
export interface BuildResultInput {
  readonly run: RunInfo;
  readonly cases: readonly CaseResult[];
  /** Added after the built-in metrics. An id that repeats a built-in or another metric is an error. */
  readonly metrics?: readonly MetricDefinition[];
  /** Slices computed from each row, merged over the slice values rows already carry. */
  readonly slices?: Readonly<Record<string, SliceSpec<CaseResult>>>;
  readonly calibration?: CalibrationReport;
  readonly grounding?: GroundingReport;
  readonly comparison?: RunComparison;
  readonly gate?: GateResult;
  readonly warnings?: readonly string[];
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

function metricSet(custom: readonly MetricDefinition[]): readonly MetricDefinition[] {
  const all = [...builtinMetrics(), ...custom];
  const seen = new Set<string>();
  const duplicates = all.filter((metric) => (seen.has(metric.id) ? true : (seen.add(metric.id), false)));
  if (duplicates.length > 0) {
    throw new EvalSpecError(
      duplicates.map((metric) => ({ code: "duplicate-metric", path: metric.id, message: "another metric already has this id" })),
    );
  }
  return all;
}

function values(metrics: readonly MetricDefinition[], rows: readonly CaseResult[], context: MetricContext): MetricValues {
  const out: Record<string, number | null> = {};
  for (const metric of metrics) out[metric.id] = metric.aggregate(rows, context);
  return out;
}

function groupBy<K, V>(items: readonly V[], keyOf: (item: V) => K): Map<K, V[]> {
  const groups = new Map<K, V[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

function fieldGroups(rows: readonly CaseResult[], keyOf: (pattern: string) => string): Record<string, FieldGroupSummary> {
  const groups = new Map<string, { counts: StatusCounts; similarity: number; compared: number }>();
  const add = (pattern: string, counts: StatusCounts, similarity: number, compared: number): void => {
    const key = keyOf(pattern);
    const group = groups.get(key) ?? { counts: ZERO_COUNTS, similarity: 0, compared: 0 };
    groups.set(key, {
      counts: addCounts(group.counts, counts),
      similarity: group.similarity + similarity,
      compared: group.compared + compared,
    });
  };
  for (const row of rows) {
    const omissions = runScopeOmissions(row);
    if (omissions !== undefined) {
      for (const [pattern, omitted] of Object.entries(omissions.paths)) add(pattern, { ...ZERO_COUNTS, omission: omitted.fields }, 0, 0);
    }
    if (row.outcome !== "scored") continue;
    for (const field of row.score.fields) {
      const compared = field.status === "match" || field.status === "mismatch";
      add(field.pattern, { ...ZERO_COUNTS, [field.status]: 1 }, compared ? field.similarity : 0, compared ? 1 : 0);
    }
  }
  const out: Record<string, FieldGroupSummary> = {};
  for (const [key, group] of groups)
    out[key] = {
      ...prf(group.counts),
      counts: group.counts,
      meanSimilarity: group.compared === 0 ? null : group.similarity / group.compared,
    };
  return out;
}

function segmentNames(run: RunInfo, rows: readonly CaseResult[]): string[] {
  const names = new Set(run.spec.fields.map((field) => field.segment));
  for (const row of rows) {
    if (row.outcome === "scored") Object.keys(row.score.segments).forEach((name) => names.add(name));
    if (row.outcome === "errored") Object.keys(row.omitted.segments).forEach((name) => names.add(name));
  }
  return [...names];
}

function epochSummary(metrics: readonly MetricDefinition[], rows: readonly CaseResult[], experiment: string): EpochSummary | undefined {
  const epochs = groupBy(rows, (row) => row.epoch);
  if (epochs.size < 2) return undefined;
  const ordered = [...epochs.keys()].sort((a, b) => a - b);
  const out: Record<string, { values: (number | null)[]; mean: number | null; stdev: number | null }> = {};
  for (const metric of metrics) {
    const series = ordered.map((epoch) => metric.aggregate(epochs.get(epoch) ?? [], { experiment, scope: "epoch" }));
    const present = series.filter((value): value is number => value !== null);
    const mean = present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
    const stdev =
      mean === null || present.length < 2
        ? null
        : Math.sqrt(present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (present.length - 1));
    out[metric.id] = { values: series, mean, stdev };
  }
  return { epochs: ordered.length, metrics: out };
}

function summarize(
  input: BuildResultInput,
  metrics: readonly MetricDefinition[],
  experiment: string,
  rows: readonly CaseResult[],
  slicesOf: (row: CaseResult) => Readonly<Record<string, TagValue>>,
): Summary {
  const segments: Record<string, Summary["segments"][string]> = {};
  for (const name of segmentNames(input.run, rows)) {
    let counts = ZERO_COUNTS;
    let weighted = ZERO_COUNTS;
    for (const row of rows) {
      if (row.outcome === "errored") {
        const omitted = row.omitted.segments[name];
        if (omitted === undefined) continue;
        counts = addCounts(counts, { ...ZERO_COUNTS, omission: omitted.fields });
        weighted = addCounts(weighted, { ...ZERO_COUNTS, omission: omitted.weight });
      }
      const segment = row.outcome === "scored" ? row.score.segments[name] : undefined;
      if (segment === undefined) continue;
      counts = addCounts(counts, segment.counts);
      weighted = addCounts(weighted, segment.weighted);
    }
    segments[name] = { counts, weighted, metrics: prfValues(rows, name) };
  }
  const slices: Record<string, Record<string, { cases: number; metrics: MetricValues }>> = {};
  const byName = new Map<string, Map<string, CaseResult[]>>();
  for (const row of rows) {
    for (const [name, value] of Object.entries(slicesOf(row))) {
      let groups = byName.get(name);
      if (groups === undefined) byName.set(name, (groups = new Map()));
      const key = String(value);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [row]);
      else group.push(row);
    }
  }
  for (const [name, groups] of byName) {
    const out: Record<string, { cases: number; metrics: MetricValues }> = {};
    for (const [value, group] of groups)
      out[value] = { cases: group.length, metrics: values(metrics, group, { experiment, scope: "slice" }) };
    slices[name] = out;
  }
  const types = new Map(input.run.spec.fields.map((field) => [field.pattern, field.type]));
  const calibration = input.calibration?.experiments[experiment];
  const grounding = input.grounding?.experiments[experiment];
  const epochs = epochSummary(metrics, rows, experiment);
  return {
    cases: {
      total: rows.length,
      scored: rows.filter((row) => row.outcome === "scored").length,
      errored: rows.filter((row) => row.outcome === "errored").length,
      skipped: rows.filter((row) => row.outcome === "skipped").length,
    },
    overall: values(metrics, rows, {
      experiment,
      scope: "overall",
      ...(calibration === undefined ? {} : { calibration }),
      ...(grounding === undefined ? {} : { grounding }),
    }),
    segments,
    slices,
    paths: fieldGroups(rows, (pattern) => pattern),
    fieldTypes: fieldGroups(rows, (pattern) => types.get(pattern) ?? "unknown"),
    ...(epochs === undefined ? {} : { epochs }),
  };
}

function withCaseValues(metrics: readonly MetricDefinition[], rows: readonly CaseResult[]): CaseResult[] {
  const perCase = metrics.filter((metric) => metric.perCase !== undefined);
  if (perCase.length === 0) return [...rows];
  return rows.map((row) => {
    const values: Record<string, number | null> = { ...row.values };
    for (const metric of perCase) values[metric.id] = metric.perCase?.(row) ?? null;
    return { ...row, values };
  });
}

const FALLBACK_NAMES: Readonly<Record<string, string>> = { greedy: "greedy", "ordered-greedy": "order-preserving greedy" };

function alignmentWarnings(rows: readonly CaseResult[]): string[] {
  const fallbacks = new Map<string, number>();
  for (const row of rows) {
    if (row.outcome !== "scored") continue;
    for (const report of row.score.arrays) {
      if (!isFallback(report.algorithm)) continue;
      const key = `${report.pattern}\u0000${report.algorithm}`;
      fallbacks.set(key, (fallbacks.get(key) ?? 0) + 1);
    }
  }
  return [...fallbacks].map(([key, count]) => {
    const [pattern, algorithm] = key.split("\u0000") as [string, string];
    return `Alignment of ${pattern} fell back to ${FALLBACK_NAMES[algorithm]} pairing in ${count} case${count === 1 ? "" : "s"} because the cost matrix exceeded its cell budget. Add a key or raise maxCells to align exactly.`;
  });
}

/**
 * Assemble a complete result from case rows: per experiment, the overall metrics,
 * segment, slice, path and field-type summaries, and epoch variance. A project
 * that runs its own loop can build rows itself and still use every reporter.
 */
export function buildResult(input: BuildResultInput): EvalResult {
  const metrics = metricSet(input.metrics ?? []);
  const computed = input.slices;
  const slicesOf = (row: CaseResult): Readonly<Record<string, TagValue>> =>
    computed === undefined ? (row.slices ?? {}) : { ...row.slices, ...sliceValues(computed, row) };
  const experiments = [
    ...new Set([...input.run.experiments.map((experiment) => experiment.id), ...input.cases.map((row) => row.experiment)]),
  ];
  const cases = withCaseValues(metrics, input.cases);
  const byExperiment = groupBy(cases, (row) => row.experiment);
  const summary: Record<string, Summary> = {};
  for (const experiment of experiments)
    summary[experiment] = summarize(input, metrics, experiment, byExperiment.get(experiment) ?? [], slicesOf);
  return {
    format: RESULT_FORMAT,
    version: RESULT_VERSION,
    run: input.run,
    metrics: metrics.map(({ id, label, direction, format }) => ({ id, label, direction, format })),
    summary,
    cases,
    ...(input.calibration === undefined ? {} : { calibration: input.calibration }),
    ...(input.grounding === undefined ? {} : { grounding: input.grounding }),
    ...(input.comparison === undefined ? {} : { comparison: input.comparison }),
    ...(input.gate === undefined ? {} : { gate: input.gate }),
    warnings: [...(input.warnings ?? []), ...alignmentWarnings(input.cases)],
    extensions: input.extensions ?? {},
  };
}
