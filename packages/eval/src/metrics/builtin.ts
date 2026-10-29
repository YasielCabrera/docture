import type { CalibrationStats } from "../result/sections.js";
import type { CaseResult, OmittedCount, OmittedLeaves } from "../result/types.js";
import { ZERO_COUNTS, addCounts, prf, type CaseScore, type Prf, type StatusCounts } from "../score/types.js";
import type { MetricDefinition, MetricInfo } from "./types.js";

/** How errored cases count. `micro` pools scored cases; `macro` averages them; `run` also counts an errored case's expected leaves as omissions. */
export type PrfScope = "micro" | "macro" | "run";

/** What `omitted` an errored case records, computed from a score against an absent output. */
export function omittedOf(score: CaseScore): OmittedLeaves {
  const segments: Record<string, OmittedCount> = {};
  for (const [name, segment] of Object.entries(score.segments)) {
    if (segment.counts.omission > 0) segments[name] = { fields: segment.counts.omission, weight: segment.weighted.omission };
  }
  const paths: Record<string, OmittedCount> = {};
  for (const field of score.fields) {
    if (field.status !== "omission") continue;
    const before = paths[field.pattern] ?? { fields: 0, weight: 0 };
    paths[field.pattern] = { fields: before.fields + 1, weight: before.weight + field.weight };
  }
  return { fields: score.counts.omission, weight: score.weighted.omission, segments, paths };
}

/** Omitted leaves of an errored row count only at run scope. */
export function runScopeOmissions(row: CaseResult, scope: string = "run"): OmittedLeaves | undefined {
  return row.outcome === "errored" && scope === "run" ? row.omitted : undefined;
}

function weightedOf(row: CaseResult, segment: string | undefined): StatusCounts | undefined {
  if (row.outcome === "scored") return segment === undefined ? row.score.weighted : (row.score.segments[segment]?.weighted ?? ZERO_COUNTS);
  const omitted = runScopeOmissions(row);
  if (omitted !== undefined) {
    const omission = segment === undefined ? omitted.weight : (omitted.segments[segment]?.weight ?? 0);
    return { ...ZERO_COUNTS, omission };
  }
  return undefined;
}

function caseScope(row: CaseResult, segment: string | undefined, scope: PrfScope): Prf | undefined {
  if (row.outcome === "skipped" || (row.outcome === "errored" && scope !== "run")) return undefined;
  const counts = weightedOf(row, segment);
  return counts === undefined ? undefined : prf(counts);
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
}

/** Precision, recall and F1 of rows in one scope, optionally restricted to a segment. */
export function prfOf(rows: readonly CaseResult[], scope: PrfScope, segment?: string): Prf {
  if (scope === "macro") {
    const perCase = rows.map((row) => caseScope(row, segment, "micro")).filter((value): value is Prf => value !== undefined);
    return {
      precision: mean(perCase.map((p) => p.precision)),
      recall: mean(perCase.map((p) => p.recall)),
      f1: mean(perCase.map((p) => p.f1)),
    };
  }
  let counts = ZERO_COUNTS;
  for (const row of rows) {
    if (row.outcome === "errored" && scope !== "run") continue;
    const weighted = weightedOf(row, segment);
    if (weighted !== undefined) counts = addCounts(counts, weighted);
  }
  return prf(counts);
}

const PRF_IDS: readonly { readonly scope: PrfScope; readonly suffix: string; readonly label: string }[] = [
  { scope: "run", suffix: "", label: "" },
  { scope: "micro", suffix: ".micro", label: " (micro)" },
  { scope: "macro", suffix: ".macro", label: " (macro)" },
];

/** The metric id of precision, recall or F1 in a scope: `f1` for run scope, `f1.micro`, `f1.macro`. */
export function prfMetricId(metric: "precision" | "recall" | "f1", scope: PrfScope = "run"): string {
  return scope === "run" ? metric : `${metric}.${scope}`;
}

/** Precision, recall and F1 in every scope, keyed by metric id. Segment summaries use exactly these. */
export function prfValues(rows: readonly CaseResult[], segment?: string): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const { scope } of PRF_IDS) {
    const values = prfOf(rows, scope, segment);
    out[prfMetricId("precision", scope)] = values.precision;
    out[prfMetricId("recall", scope)] = values.recall;
    out[prfMetricId("f1", scope)] = values.f1;
  }
  return out;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Linear interpolation between closest ranks. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

function sumOptional(rows: readonly CaseResult[], pick: (row: CaseResult) => number | undefined): number | null {
  let sum = 0;
  let seen = false;
  for (const row of rows) {
    const value = pick(row);
    if (value === undefined) continue;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

function tokensOf(row: CaseResult): number | undefined {
  const { inputTokens, outputTokens } = row.usage ?? {};
  return inputTokens === undefined && outputTokens === undefined ? undefined : (inputTokens ?? 0) + (outputTokens ?? 0);
}

function prfMetrics(): MetricDefinition[] {
  const out: MetricDefinition[] = [];
  for (const { scope, suffix, label } of PRF_IDS) {
    for (const [name, title] of [
      ["precision", "Precision"],
      ["recall", "Recall"],
      ["f1", "F1"],
    ] as const) {
      out.push({
        id: `${name}${suffix}`,
        label: `${title}${label}`,
        direction: "higher",
        format: "ratio",
        perCase: (row) => caseScope(row, undefined, scope === "macro" ? "micro" : scope)?.[name] ?? null,
        aggregate: (rows) => prfOf(rows, scope)[name],
      });
    }
  }
  return out;
}

const nonSkipped = (rows: readonly CaseResult[]): CaseResult[] => rows.filter((row) => row.outcome !== "skipped");

function calibrationMetric(
  id: string,
  label: string,
  direction: MetricInfo["direction"],
  read: (stats: CalibrationStats) => number | null | undefined,
): MetricDefinition {
  return {
    id,
    label,
    direction,
    format: "ratio",
    aggregate: (_rows, context) =>
      context.scope === "overall" && context.calibration !== undefined ? (read(context.calibration.overall) ?? null) : null,
  };
}

/** The metrics every result carries. Custom metrics from `defineMetric` are added after these. */
export function builtinMetrics(): readonly MetricDefinition[] {
  return [
    ...prfMetrics(),
    {
      id: "exactRate",
      label: "Exact cases",
      direction: "higher",
      format: "ratio",
      perCase: (row) => (row.outcome === "skipped" ? null : row.outcome === "scored" && row.score.metrics.exact ? 1 : 0),
      aggregate: (rows) => {
        const graded = nonSkipped(rows);
        return ratio(graded.filter((row) => row.outcome === "scored" && row.score.metrics.exact).length, graded.length);
      },
    },
    {
      id: "anls",
      label: "ANLS",
      direction: "higher",
      format: "ratio",
      perCase: (row) => (row.outcome === "scored" ? row.score.metrics.anls : null),
      aggregate: (rows) => mean(rows.map((row) => (row.outcome === "scored" ? row.score.metrics.anls : null))),
    },
    {
      id: "groundedF1",
      label: "Grounded F1",
      direction: "higher",
      format: "ratio",
      aggregate: (_rows, context) => (context.scope === "overall" ? (context.grounding?.overall.groundedF1 ?? null) : null),
    },
    {
      id: "errorRate",
      label: "Errored cases",
      direction: "lower",
      format: "ratio",
      perCase: (row) => (row.outcome === "errored" ? 1 : 0),
      aggregate: (rows) => ratio(rows.filter((row) => row.outcome === "errored").length, rows.length),
    },
    {
      id: "skipRate",
      label: "Skipped cases",
      direction: "lower",
      format: "ratio",
      perCase: (row) => (row.outcome === "skipped" ? 1 : 0),
      aggregate: (rows) => ratio(rows.filter((row) => row.outcome === "skipped").length, rows.length),
    },
    {
      id: "fallbackRate",
      label: "Fallback cases",
      direction: "lower",
      format: "ratio",
      perCase: (row) => (row.outcome === "skipped" ? null : row.fallback === true ? 1 : 0),
      aggregate: (rows) => {
        const graded = nonSkipped(rows);
        return ratio(graded.filter((row) => row.fallback === true).length, graded.length);
      },
    },
    {
      id: "costUsd",
      label: "Cost",
      direction: "lower",
      format: "usd",
      perCase: (row) => row.usage?.costUsd ?? null,
      aggregate: (rows) => sumOptional(rows, (row) => row.usage?.costUsd),
    },
    {
      id: "tokens",
      label: "Tokens",
      direction: "lower",
      format: "count",
      perCase: (row) => tokensOf(row) ?? null,
      aggregate: (rows) => sumOptional(rows, tokensOf),
    },
    {
      id: "latencyP50",
      label: "Latency p50",
      direction: "lower",
      format: "ms",
      perCase: (row) => (row.outcome === "skipped" ? null : row.ms),
      aggregate: (rows) =>
        percentile(
          nonSkipped(rows).map((row) => row.ms),
          0.5,
        ),
    },
    {
      id: "latencyP95",
      label: "Latency p95",
      direction: "lower",
      format: "ms",
      aggregate: (rows) =>
        percentile(
          nonSkipped(rows).map((row) => row.ms),
          0.95,
        ),
    },
    calibrationMetric("ece", "Expected calibration error", "lower", (stats) => stats.ece),
    calibrationMetric("brier", "Brier score", "lower", (stats) => stats.brier),
    calibrationMetric("auroc", "AUROC", "higher", (stats) => stats.auroc),
    calibrationMetric(
      "coverageAtPrecision99",
      "Auto-accept coverage at 99% precision",
      "higher",
      (stats) => stats.coverageAtAccuracy["0.99"],
    ),
  ];
}
