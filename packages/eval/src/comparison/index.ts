import {
  EvalSpecError,
  IncomparableRunsError,
  builtinMetrics,
  runScopeOmissions,
  compareCodeUnits,
  prf,
  type CaseResult,
  type EvalResult,
  type ExperimentComparison,
  type MetricInfo,
  type MetricDelta,
  type OutcomeChange,
  type RunComparison,
  type PathDelta,
  type StatusCounts,
} from "../index.js";
import { bootstrap, mcnemar, type PairValue } from "./statistics.js";

/** Options for paired, reproducible run comparisons. */
export interface CompareOptions {
  /** One experiment id in both runs, or a baseline and candidate pair. Default: every experiment both runs have. */
  readonly experiment?: string | readonly [string, string];
  readonly test?: "bootstrap" | "mcnemar" | "auto";
  readonly resamples?: number;
  readonly seed?: string;
  readonly alpha?: number;
  readonly cluster?: "group" | "case";
}
type Pair = readonly [CaseResult, CaseResult];
type Settings = RunComparison["settings"];
const MIN_PAIRS = 5;
function invalid(message: string): never {
  throw new EvalSpecError([{ code: "invalid-rule", path: "compare", message }]);
}
function key(row: CaseResult): string {
  return JSON.stringify([row.caseId, row.epoch]);
}
function rows(result: EvalResult, experiment: string, side: string, problems: string[]): Map<string, CaseResult> {
  const map = new Map<string, CaseResult>();
  for (const row of result.cases.filter((r) => r.experiment === experiment)) {
    if (map.has(key(row))) problems.push(`the ${side} experiment ${experiment} has case ${row.caseId} epoch ${row.epoch} more than once`);
    map.set(key(row), row);
  }
  return map;
}
function experimentPairs(
  a: EvalResult,
  b: EvalResult,
  selection: CompareOptions["experiment"],
  problems: string[],
): (readonly [string, string])[] {
  if (selection !== undefined) {
    const pair: readonly [string, string] = typeof selection === "string" ? [selection, selection] : selection;
    if (a.summary[pair[0]] === undefined) problems.push(`the baseline run has no experiment ${pair[0]}`);
    if (b.summary[pair[1]] === undefined) problems.push(`the candidate run has no experiment ${pair[1]}`);
    return [pair];
  }
  const common = Object.keys(b.summary)
    .filter((id) => a.summary[id] !== undefined)
    .sort(compareCodeUnits);
  if (common.length === 0)
    problems.push(
      `the runs share no experiment (baseline: ${Object.keys(a.summary).join(", ") || "none"}; candidate: ${Object.keys(b.summary).join(", ") || "none"}); select a pair explicitly`,
    );
  return common.map((id) => [id, id] as const);
}
function value(row: CaseResult, metric: MetricInfo): number | null {
  if (row.values !== undefined && Object.hasOwn(row.values, metric.id)) return row.values[metric.id] ?? null;
  if ("perCase" in metric && typeof metric.perCase === "function") {
    const computed: unknown = metric.perCase(row);
    return typeof computed === "number" && Number.isFinite(computed) ? computed : null;
  }
  return (
    builtinMetrics()
      .find((m) => m.id === metric.id)
      ?.perCase?.(row) ?? null
  );
}
function delta(
  metric: MetricInfo,
  baseline: number | null,
  candidate: number | null,
  pairs: readonly Pair[],
  options: Settings,
  pick = (row: CaseResult) => value(row, metric),
): MetricDelta {
  const values: PairValue[] = [];
  for (const [a, b] of pairs) {
    const before = pick(a);
    const after = pick(b);
    if (before !== null && after !== null && Number.isFinite(before) && Number.isFinite(after))
      values.push({
        before,
        after,
        cluster: options.cluster === "group" && a.group !== undefined ? `group:${a.group}` : `case:${a.caseId}`,
      });
  }
  const summaryDelta = baseline === null || candidate === null ? null : candidate - baseline;
  const pairedDelta = values.length === 0 ? null : values.reduce((sum, v) => sum + v.after - v.before, 0) / values.length;
  const base = {
    metric: metric.id,
    baseline,
    candidate,
    summaryDelta,
    pairedDelta,
    ci: null,
    p: null,
    test: "none" as const,
    n: values.length,
  };
  if (summaryDelta === null) return { ...base, verdict: "incomparable" };
  if (values.length === 0) return { ...base, verdict: "not-tested" };
  if (values.every((v) => v.before === v.after)) return { ...base, verdict: "unchanged" };
  if (values.length < MIN_PAIRS || new Set(values.map((v) => v.cluster)).size < MIN_PAIRS) return { ...base, verdict: "insufficient" };
  const binary = values.every((v) => [0, 1].includes(v.before) && [0, 1].includes(v.after));
  const independent = new Set(values.map((v) => v.cluster)).size === values.length;
  const test = options.test !== "bootstrap" && binary && independent ? "mcnemar" : "bootstrap";
  const stats =
    test === "mcnemar"
      ? { ...bootstrap(values, options.resamples, options.seed, options.alpha), p: mcnemar(values) }
      : bootstrap(values, options.resamples, options.seed, options.alpha);
  const [low, high] = stats.ci;
  const shift = low > 0 ? 1 : high < 0 ? -1 : 0;
  const verdict =
    stats.p >= options.alpha || shift === 0
      ? "inconclusive"
      : shift * (metric.direction === "higher" ? 1 : -1) > 0
        ? "improved"
        : "regressed";
  return { ...base, ...stats, test, verdict };
}
function holm(family: readonly MetricDelta[], alpha: number): Map<MetricDelta, MetricDelta> {
  const tested = family.filter((m) => m.p !== null).sort((a, b) => a.p! - b.p! || compareCodeUnits(a.metric, b.metric));
  const adjusted = new Map<MetricDelta, MetricDelta>();
  let previous = 0;
  tested.forEach((m, i) => {
    const p = Math.min(1, Math.max(previous, m.p! * (tested.length - i)));
    previous = p;
    adjusted.set(m, {
      ...m,
      p,
      verdict: p >= alpha && (m.verdict === "regressed" || m.verdict === "improved") ? "inconclusive" : m.verdict,
    });
  });
  return adjusted;
}
const zero: StatusCounts = { match: 0, mismatch: 0, omission: 0, hallucination: 0 };
function pathCounts(row: CaseResult, pattern: string): StatusCounts {
  const omitted = runScopeOmissions(row);
  if (omitted !== undefined) return { ...zero, omission: omitted.paths[pattern]?.weight ?? 0 };
  const out = { ...zero };
  if (row.outcome === "scored") for (const field of row.score.fields) if (field.pattern === pattern) out[field.status] += field.weight;
  return out;
}
function segmentScore(row: CaseResult, segment: string, metric: string): number | null {
  const [name, scope = "run"] = metric.split(".") as ["precision" | "recall" | "f1", string?];
  if (row.outcome === "scored") return row.score.segments[segment]?.[name] ?? null;
  const omitted = runScopeOmissions(row, scope);
  if (omitted !== undefined) return prf({ ...zero, omission: omitted.segments[segment]?.weight ?? 0 })[name];
  return null;
}
function compareExperiment(
  baseline: EvalResult,
  candidate: EvalResult,
  baseId: string,
  candId: string,
  a: Map<string, CaseResult>,
  b: Map<string, CaseResult>,
  o: Settings,
): ExperimentComparison {
  const pairs: Pair[] = [...a]
    .sort(([x], [y]) => compareCodeUnits(x, y))
    .flatMap(([id, row]) => {
      const other = b.get(id);
      return other === undefined || (row.configHash !== undefined && other.configHash !== undefined && row.configHash !== other.configHash)
        ? []
        : [[row, other] satisfies Pair];
    });
  const base = baseline.summary[baseId]!;
  const cand = candidate.summary[candId]!;
  const metrics = [...new Map([...baseline.metrics, ...candidate.metrics].map((m) => [m.id, m])).values()];
  const compare = (
    left: Readonly<Record<string, number | null>>,
    right: Readonly<Record<string, number | null>>,
    subset: readonly Pair[],
  ) => metrics.map((m) => delta(m, left[m.id] ?? null, right[m.id] ?? null, subset, o));
  const slices: Record<string, Record<string, readonly MetricDelta[]>> = {};
  for (const name of [...new Set([...Object.keys(base.slices), ...Object.keys(cand.slices)])].sort(compareCodeUnits)) {
    const groups: Record<string, readonly MetricDelta[]> = {};
    for (const v of [...new Set([...Object.keys(base.slices[name] ?? {}), ...Object.keys(cand.slices[name] ?? {})])].sort(
      compareCodeUnits,
    )) {
      groups[v] = compare(
        base.slices[name]?.[v]?.metrics ?? {},
        cand.slices[name]?.[v]?.metrics ?? {},
        pairs.filter(
          ([x, y]) =>
            String(x.slices === undefined ? x.tags[name] : x.slices[name]) === v &&
            String(y.slices === undefined ? y.tags[name] : y.slices[name]) === v,
        ),
      );
    }
    slices[name] = groups;
  }
  const segments: Record<string, readonly MetricDelta[]> = {};
  for (const name of [...new Set([...Object.keys(base.segments), ...Object.keys(cand.segments)])].sort(compareCodeUnits)) {
    segments[name] = metrics
      .filter((m) => /^(precision|recall|f1)(\.(micro|macro))?$/u.test(m.id))
      .map((m) =>
        delta(m, base.segments[name]?.metrics[m.id] ?? null, cand.segments[name]?.metrics[m.id] ?? null, pairs, o, (row) =>
          segmentScore(row, name, m.id),
        ),
      );
  }
  const paths: PathDelta[] = [...new Set([...Object.keys(base.paths), ...Object.keys(cand.paths)])]
    .sort(compareCodeUnits)
    .map((pattern) => ({
      pattern,
      counts: { baseline: base.paths[pattern]?.counts ?? zero, candidate: cand.paths[pattern]?.counts ?? zero },
      f1: delta(
        { id: "f1", direction: "higher", label: "F1", format: "ratio" },
        base.paths[pattern]?.f1 ?? null,
        cand.paths[pattern]?.f1 ?? null,
        pairs,
        o,
        (row) => prf(pathCounts(row, pattern)).f1,
      ),
    }));
  const segmentAdjustment = holm(Object.values(segments).flat(), o.alpha);
  for (const name of Object.keys(segments)) segments[name] = segments[name]!.map((m) => segmentAdjustment.get(m) ?? m);
  const sliceAdjustment = holm(
    Object.values(slices).flatMap((groups) => Object.values(groups).flat()),
    o.alpha,
  );
  for (const groups of Object.values(slices))
    for (const name of Object.keys(groups)) groups[name] = groups[name]!.map((m) => sliceAdjustment.get(m) ?? m);
  const pathAdjustment = holm(
    paths.map((path) => path.f1),
    o.alpha,
  );
  const adjustedPaths = paths.map((path) => ({ ...path, f1: pathAdjustment.get(path.f1) ?? path.f1 }));
  const cases: {
    regressed: ExperimentComparison["cases"]["regressed"][number][];
    improved: ExperimentComparison["cases"]["improved"][number][];
    newlyErrored: OutcomeChange[];
    fixed: OutcomeChange[];
  } = { regressed: [], improved: [], newlyErrored: [], fixed: [] };
  for (const [x, y] of pairs) {
    const change = { caseId: x.caseId, epoch: x.epoch, baseline: x.outcome, candidate: y.outcome };
    if (x.outcome !== "errored" && y.outcome === "errored") cases.newlyErrored.push(change);
    if (x.outcome === "errored" && y.outcome === "scored") cases.fixed.push(change);
    for (const m of metrics) {
      const before = value(x, m);
      const after = value(y, m);
      if (before === null || after === null || before === after) continue;
      cases[(after - before) * (m.direction === "higher" ? 1 : -1) > 0 ? "improved" : "regressed"].push({
        caseId: x.caseId,
        epoch: x.epoch,
        metric: m.id,
        baseline: before,
        candidate: after,
      });
    }
  }
  return {
    baseline: baseId,
    candidate: candId,
    pairs: { paired: pairs.length, baselineOnly: a.size - pairs.length, candidateOnly: b.size - pairs.length },
    metrics: compare(base.overall, cand.overall, pairs),
    segments,
    slices,
    paths: adjustedPaths,
    cases,
  };
}
/**
 * Compare every experiment both runs have, or the selected pair, over paired case and epoch rows with exact
 * McNemar or a seeded, group-clustered bootstrap (FNV-1a/Mulberry32).
 * Small samples (at most 20 clusters) use exact sign-flip p-values; subgroup families use Holm correction.
 * Throws {@link IncomparableRunsError} listing every reason the runs cannot be paired.
 */
export function compareRuns(baseline: EvalResult, candidate: EvalResult, options: CompareOptions = {}): RunComparison {
  const o: Settings = {
    test: options.test ?? "auto",
    resamples: options.resamples ?? 10_000,
    seed: options.seed ?? "docture-eval",
    alpha: options.alpha ?? 0.05,
    cluster: options.cluster ?? "group",
  };
  if (!Number.isSafeInteger(o.resamples) || o.resamples < 1 || !Number.isFinite(o.alpha) || o.alpha <= 0 || o.alpha >= 1)
    invalid("resamples must be a positive integer and alpha must be in (0, 1)");
  const problems: string[] = [];
  const selected = experimentPairs(baseline, candidate, options.experiment, problems).map(([baseId, candId]) => {
    const a = rows(baseline, baseId, "baseline", problems);
    const b = rows(candidate, candId, "candidate", problems);
    if (baseline.summary[baseId] !== undefined && candidate.summary[candId] !== undefined && ![...a.keys()].some((id) => b.has(id)))
      problems.push(`experiments ${baseId} and ${candId} have no case and epoch in common`);
    return { baseId, candId, a, b };
  });
  if (problems.length > 0) throw new IncomparableRunsError(problems);
  const experiments: Record<string, ExperimentComparison> = {};
  for (const { baseId, candId, a, b } of selected) experiments[candId] = compareExperiment(baseline, candidate, baseId, candId, a, b, o);
  const pairingWarnings = Object.entries(experiments).flatMap(([id, comparison]) => {
    const warnings: string[] = [];
    if (comparison.pairs.baselineOnly > 0 || comparison.pairs.candidateOnly > 0)
      warnings.push(
        `Experiment ${id} has unpaired rows: baselineOnly=${comparison.pairs.baselineOnly}, candidateOnly=${comparison.pairs.candidateOnly}`,
      );
    const selectedPair = selected.find((pair) => pair.candId === id)!;
    if (
      [...selectedPair.a].some(([key, row]) => {
        const other = selectedPair.b.get(key);
        return other !== undefined && row.configHash !== undefined && other.configHash !== undefined && row.configHash !== other.configHash;
      })
    )
      warnings.push(`Experiment ${id} has rows with differing configHash; excluded from pairing`);
    return warnings;
  });
  const dataset = baseline.run.dataset.fingerprint === candidate.run.dataset.fingerprint;
  const spec = baseline.run.spec.fingerprint === candidate.run.spec.fingerprint;
  return {
    baselineRunId: baseline.run.id,
    candidateRunId: candidate.run.id,
    settings: o,
    compatible: {
      dataset,
      spec,
      warnings: [...(dataset ? [] : ["Dataset fingerprints differ"]), ...(spec ? [] : ["Spec fingerprints differ"]), ...pairingWarnings],
    },
    experiments,
  };
}
