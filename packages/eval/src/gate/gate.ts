import { EvalSpecError, type SpecProblem } from "../errors.js";
import { prfMetricId } from "../metrics/builtin.js";
import type { MetricInfo } from "../metrics/types.js";
import type { EvalResult, Summary } from "../result/types.js";
import type { GateCheck, GateOptions, GateResult, GateThreshold } from "./types.js";

type PrfName = "precision" | "recall" | "f1";

function isPrf(metric: string): metric is PrfName {
  return metric === "precision" || metric === "recall" || metric === "f1";
}

function metricId(threshold: GateThreshold, path: string, problems: SpecProblem[]): string {
  if (threshold.scope === undefined) return threshold.metric;
  if (!isPrf(threshold.metric)) {
    problems.push({ code: "invalid-rule", path, message: `scope applies to precision, recall and f1, not ${threshold.metric}` });
    return threshold.metric;
  }
  return prfMetricId(threshold.metric, threshold.scope);
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/u, "");
}

interface Target {
  readonly label: string;
  read(summary: Summary): number | null;
}

function targetOf(threshold: GateThreshold, id: string, path: string, metrics: ReadonlyMap<string, MetricInfo>, problems: SpecProblem[]): Target | undefined {
  const restrictions = [threshold.segment, threshold.slice, threshold.path].filter((value) => value !== undefined).length;
  if (restrictions > 1) {
    problems.push({ code: "invalid-rule", path, message: "a threshold takes at most one of segment, slice and path" });
    return undefined;
  }
  if (threshold.path !== undefined) {
    const name = threshold.metric;
    if (!isPrf(name) || (threshold.scope !== undefined && threshold.scope !== "run")) {
      problems.push({ code: "invalid-rule", path, message: "path thresholds support precision, recall and f1 at run scope" });
      return undefined;
    }
    const pattern = threshold.path;
    return { label: `${threshold.metric} at ${pattern}`, read: (summary) => summary.paths[pattern]?.[name] ?? null };
  }
  if (!metrics.has(id)) {
    problems.push({ code: "invalid-rule", path, message: `unknown metric ${id}; the result has ${[...metrics.keys()].join(", ")}` });
    return undefined;
  }
  if (threshold.segment !== undefined) {
    if (!isPrf(id.split(".")[0] ?? "")) {
      problems.push({ code: "invalid-rule", path, message: "segment thresholds support precision, recall and f1" });
      return undefined;
    }
    const segment = threshold.segment;
    return { label: `${id} in segment ${segment}`, read: (summary) => summary.segments[segment]?.metrics[id] ?? null };
  }
  if (threshold.slice !== undefined) {
    const entries = Object.entries(threshold.slice);
    const entry = entries[0];
    if (entries.length !== 1 || entry === undefined) {
      problems.push({ code: "invalid-rule", path, message: "a slice filter names exactly one slice" });
      return undefined;
    }
    const [name, value] = entry;
    return { label: `${id} for ${name}=${String(value)}`, read: (summary) => summary.slices[name]?.[String(value)]?.metrics[id] ?? null };
  }
  return { label: id, read: (summary) => summary.overall[id] ?? null };
}

function bounds(threshold: { readonly min?: number; readonly max?: number }, path: string, problems: SpecProblem[]): void {
  if (threshold.min === undefined && threshold.max === undefined) problems.push({ code: "invalid-rule", path, message: "a threshold needs min or max" });
  for (const bound of [threshold.min, threshold.max]) {
    if (bound !== undefined && !Number.isFinite(bound)) problems.push({ code: "invalid-rule", path, message: "min and max must be finite numbers" });
  }
}

function thresholdChecks(result: EvalResult, options: GateOptions, problems: SpecProblem[]): (() => GateCheck[])[] {
  const metrics = new Map(result.metrics.map((metric) => [metric.id, metric]));
  const thresholds: GateThreshold[] = [
    ...(options.thresholds ?? []),
    ...(options.maxErrorRate === undefined ? [] : [{ metric: "errorRate", max: options.maxErrorRate }]),
    ...(options.maxFallbackRate === undefined ? [] : [{ metric: "fallbackRate", max: options.maxFallbackRate }]),
  ];
  const onNull = options.onNull ?? "fail";
  return thresholds.map((threshold, index) => {
    const path = `thresholds[${index}]`;
    bounds(threshold, path, problems);
    const id = metricId(threshold, path, problems);
    const target = targetOf(threshold, id, path, metrics, problems);
    const experiments = threshold.experiment === undefined ? Object.keys(result.summary) : [threshold.experiment];
    if (threshold.experiment !== undefined && result.summary[threshold.experiment] === undefined) {
      problems.push({ code: "invalid-rule", path, message: `unknown experiment ${threshold.experiment}` });
    }
    return () => experiments.map((experiment): GateCheck => {
      const summary = result.summary[experiment];
      const value = summary === undefined ? null : (target?.read(summary) ?? null);
      const base = {
        kind: "threshold" as const,
        experiment,
        metric: id,
        target: target?.label ?? id,
        value,
        ...(threshold.min === undefined ? {} : { min: threshold.min }),
        ...(threshold.max === undefined ? {} : { max: threshold.max }),
      };
      const where = `${base.target} for experiment ${experiment}`;
      if (value === null) {
        return { ...base, status: onNull === "pass" ? "skipped" : "fail", message: `${where} has no value` };
      }
      if (threshold.min !== undefined && value < threshold.min) {
        return { ...base, status: "fail", message: `${where} is ${formatValue(value)}, below the minimum ${threshold.min}` };
      }
      if (threshold.max !== undefined && value > threshold.max) {
        return { ...base, status: "fail", message: `${where} is ${formatValue(value)}, above the maximum ${threshold.max}` };
      }
      return { ...base, status: "pass", message: `${where} is ${formatValue(value)}` };
    });
  });
}

function regressionChecks(result: EvalResult, options: GateOptions, problems: SpecProblem[]): GateCheck[] {
  const rules = options.regressions;
  if (rules === undefined) return [];
  const directions = new Map(result.metrics.map((metric) => [metric.id, metric.direction]));
  const maxDrop: [string, number, "higher" | "lower"][] = [];
  for (const [metric, budget] of Object.entries(rules.maxDrop ?? {})) {
    const path = `regressions.maxDrop.${metric}`;
    if (!(Number.isFinite(budget) && budget >= 0)) problems.push({ code: "invalid-rule", path, message: "a drop budget must be a finite number of at least 0" });
    const direction = directions.get(metric);
    if (direction === undefined) problems.push({ code: "invalid-rule", path, message: `unknown metric ${metric}` });
    else maxDrop.push([metric, budget, direction]);
  }
  const compared = Object.entries(result.comparison?.experiments ?? {});
  if (compared.length === 0) {
    return [{ kind: "regression", experiment: "", metric: "", target: "regressions", value: null, status: "skipped", message: "no baseline comparison in this result; regression budgets were not checked" }];
  }
  const onNull = options.onNull ?? "fail";
  const checks: GateCheck[] = [];
  for (const [experiment, comparison] of compared) {
    const deltas = new Map(comparison.metrics.map((delta) => [delta.metric, delta]));
    for (const [metric, budget, direction] of maxDrop) {
      const delta = deltas.get(metric);
      const base = { kind: "regression" as const, experiment, metric, target: `${metric} drop`, max: budget };
      if (delta === undefined || delta.summaryDelta === null) {
        checks.push({ ...base, value: null, status: onNull === "pass" ? "skipped" : "fail", message: `${metric} for experiment ${experiment} has no comparable change against the baseline` });
        continue;
      }
      const drop = direction === "higher" ? -delta.summaryDelta : delta.summaryDelta;
      const within = drop <= budget;
      const ignored = !within && rules.requireSignificance === true && delta.verdict !== "regressed";
      const message = within
        ? `${metric} for experiment ${experiment} changed by ${formatValue(delta.summaryDelta)}, within the drop budget ${budget}`
        : ignored
          ? `${metric} for experiment ${experiment} dropped by ${formatValue(drop)}, over the budget ${budget}, but the comparison found it ${delta.verdict}, not regressed`
          : `${metric} for experiment ${experiment} dropped by ${formatValue(drop)}, over the budget ${budget}`;
      checks.push({ ...base, value: drop, status: within || ignored ? "pass" : "fail", message });
    }
    if (rules.requireSignificance === true && maxDrop.length === 0) {
      const regressed = comparison.metrics.filter((delta) => delta.verdict === "regressed");
      for (const delta of regressed) {
        checks.push({ kind: "regression", experiment, metric: delta.metric, target: `${delta.metric} change`, value: delta.pairedDelta, status: "fail", message: `${delta.metric} for experiment ${experiment} regressed significantly (p ${delta.p ?? "n/a"})` });
      }
      if (regressed.length === 0) checks.push({ kind: "regression", experiment, metric: "", target: "significant regressions", value: 0, status: "pass", message: `no metric regressed significantly for experiment ${experiment}` });
    }
  }
  return checks;
}

function runCheck(result: EvalResult): GateCheck[] {
  const { status, dataset, experiments, epochs } = result.run;
  if (status === "complete") return [];
  const jobs = dataset.size * experiments.length * epochs;
  const message = `the run is ${status} with ${result.cases.length} of ${jobs} jobs recorded; a gate needs a complete run`;
  return [{ kind: "run", experiment: "", metric: "", target: "run status", value: null, status: "fail", message }];
}

/**
 * Check a result against thresholds and regression budgets. Equality passes.
 * A run that is not `complete` fails. A missing value fails unless `onNull` is `pass`.
 * Invalid options throw one {@link EvalSpecError} listing every problem.
 */
export function gate(result: EvalResult, options: GateOptions): GateResult {
  const problems: SpecProblem[] = [];
  const pending = thresholdChecks(result, options, problems);
  const regressions = regressionChecks(result, options, problems);
  if (problems.length > 0) throw new EvalSpecError(problems);
  const checks = [...runCheck(result), ...pending.flatMap((run) => run()), ...regressions];
  return { pass: checks.every((check) => check.status !== "fail"), checks };
}
