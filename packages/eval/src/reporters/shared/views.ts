import { builtinMetrics } from "../../metrics/builtin.js";
import { compareCodeUnits } from "../../order.js";
import type { MetricFormat, MetricInfo } from "../../metrics/types.js";
import type { CalibrationStats, GroundingScore, MetricDelta } from "../../result/sections.js";
import type { EvalResult, MetricValues } from "../../result/types.js";
import type { StatusCounts } from "../../score/types.js";
import { formatCount, formatDelta, formatMetric, formatNumber, formatPercent, NOT_AVAILABLE } from "./format.js";

/** A summary table with display text in every cell. Markdown, the terminal and the HTML report render the same views. */
export interface TableView {
  readonly title: string;
  readonly columns: readonly string[];
  /** Per column: right-align it. */
  readonly numeric: readonly boolean[];
  readonly rows: readonly (readonly string[])[];
  readonly notes: readonly string[];
}

function table(title: string, columns: readonly (readonly [string, boolean])[], rows: readonly (readonly string[])[], notes: readonly string[] = []): TableView {
  return { title, columns: columns.map(([name]) => name), numeric: columns.map(([, numeric]) => numeric), rows, notes };
}

/** Experiment ids in result order. */
export function experimentsOf(result: EvalResult): readonly string[] {
  return Object.keys(result.summary);
}

function titled(result: EvalResult, title: string, experiment: string): string {
  return experimentsOf(result).length > 1 ? `${title}: ${experiment}` : title;
}

/** The stored description of a metric, or a plain number format for an id the result does not describe. */
export function metricInfo(result: EvalResult, id: string): MetricInfo {
  return result.metrics.find((metric) => metric.id === id) ?? { id, label: id, direction: "higher", format: "number" };
}

const HEADLINE = ["f1", "precision", "recall", "exactRate", "anls", "groundedF1", "errorRate", "skipRate", "fallbackRate", "costUsd", "tokens", "latencyP50", "latencyP95"];

/** The headline metrics plus every custom metric, leaving out metrics no experiment has a value for. */
export function headlineMetrics(result: EvalResult): readonly MetricInfo[] {
  const builtin = new Set(builtinMetrics().map((metric) => metric.id));
  const ids = [...HEADLINE, ...result.metrics.map((metric) => metric.id).filter((id) => !builtin.has(id))];
  const summaries = Object.values(result.summary);
  return ids
    .filter((id) => result.metrics.some((metric) => metric.id === id) && summaries.some((summary) => (summary.overall[id] ?? null) !== null))
    .map((id) => metricInfo(result, id));
}

function value(values: MetricValues, id: string, format: MetricFormat): string {
  return formatMetric(values[id] ?? null, format);
}

/** Case counts and headline metrics, one column per experiment. */
export function overviewTable(result: EvalResult): TableView {
  const experiments = experimentsOf(result);
  const count = (pick: (cases: EvalResult["summary"][string]["cases"]) => number): string[] =>
    experiments.map((id) => formatCount(pick(result.summary[id]!.cases)));
  const rows = [
    ["Cases", ...count((cases) => cases.total)],
    ["Scored", ...count((cases) => cases.scored)],
    ["Errored", ...count((cases) => cases.errored)],
    ["Skipped", ...count((cases) => cases.skipped)],
    ...headlineMetrics(result).map((metric) => [metric.label, ...experiments.map((id) => value(result.summary[id]!.overall, metric.id, metric.format))]),
  ];
  return table("Overview", [["Metric", false], ...experiments.map((id) => [id, true] as const)], rows);
}

const COUNT_COLUMNS = [["Match", true], ["Mismatch", true], ["Omission", true], ["Hallucination", true]] as const;

function countCells(counts: StatusCounts): string[] {
  return [counts.match, counts.mismatch, counts.omission, counts.hallucination].map(formatCount);
}

/** Per experiment: precision, recall, F1 and field counts per segment. */
export function segmentTables(result: EvalResult): readonly TableView[] {
  return experimentsOf(result).flatMap((experiment) => {
    const segments = Object.entries(result.summary[experiment]!.segments).sort(([a], [b]) => compareCodeUnits(a, b));
    if (segments.length === 0) return [];
    const rows = segments.map(([name, segment]) => [
      name,
      formatPercent(segment.metrics.f1 ?? null),
      formatPercent(segment.metrics.precision ?? null),
      formatPercent(segment.metrics.recall ?? null),
      ...countCells(segment.counts),
    ]);
    return [table(titled(result, "Segments", experiment), [["Segment", false], ["F1", true], ["Precision", true], ["Recall", true], ...COUNT_COLUMNS], rows)];
  });
}

/** Per experiment and slice name: case count and headline scores per slice value. One slice name, or all. */
export function sliceTables(result: EvalResult, name?: string): readonly TableView[] {
  const metrics = ["f1", "precision", "recall", "exactRate", "errorRate"].map((id) => metricInfo(result, id));
  return experimentsOf(result).flatMap((experiment) => {
    const slices = result.summary[experiment]!.slices;
    const names = name === undefined ? Object.keys(slices).sort() : [name];
    return names.flatMap((slice) => {
      const groups = slices[slice];
      if (groups === undefined) return [];
      const rows = Object.entries(groups)
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .map(([key, group]) => [key, formatCount(group.cases), ...metrics.map((metric) => value(group.metrics, metric.id, metric.format))]);
      return [table(titled(result, `Slice ${slice}`, experiment), [[slice, false], ["Cases", true], ...metrics.map((metric) => [metric.label, true] as const)], rows)];
    });
  });
}

/** Per experiment: path patterns, worst F1 first. */
export function pathTables(result: EvalResult, limit = Number.POSITIVE_INFINITY): readonly TableView[] {
  return experimentsOf(result).flatMap((experiment) => {
    const paths = Object.entries(result.summary[experiment]!.paths).sort(([a, x], [b, y]) => (x.f1 ?? 2) - (y.f1 ?? 2) || compareCodeUnits(a, b));
    if (paths.length === 0) return [];
    const shown = paths.slice(0, limit);
    const rows = shown.map(([pattern, group]) => [pattern, formatPercent(group.f1), ...countCells(group.counts), formatNumber(group.meanSimilarity)]);
    const notes = paths.length > shown.length ? [`${paths.length - shown.length} more paths not shown.`] : [];
    return [table(titled(result, "Paths", experiment), [["Path", false], ["F1", true], ...COUNT_COLUMNS, ["Similarity", true]], rows, notes)];
  });
}

function formatP(p: number | null): string {
  if (p === null) return NOT_AVAILABLE;
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

function deltaCells(result: EvalResult, delta: MetricDelta): string[] {
  const metric = metricInfo(result, delta.metric);
  const ci = delta.ci === null ? NOT_AVAILABLE : `${formatDelta(delta.ci[0], metric.format)} to ${formatDelta(delta.ci[1], metric.format)}`;
  return [
    metric.label,
    formatMetric(delta.baseline, metric.format),
    formatMetric(delta.candidate, metric.format),
    formatDelta(delta.summaryDelta, metric.format),
    formatDelta(delta.pairedDelta, metric.format),
    ci,
    formatP(delta.p),
    VERDICTS[delta.verdict],
  ];
}

const VERDICTS = {
  improved: "IMPROVED",
  regressed: "REGRESSED",
  unchanged: "unchanged (identical pairs)",
  inconclusive: "inconclusive (not significant)",
  insufficient: "insufficient support",
  "not-tested": "not tested (no paired values)",
  incomparable: "incomparable (missing value)",
} satisfies Record<MetricDelta["verdict"], string>;

const DELTA_COLUMNS = [["Metric", false], ["Baseline", true], ["Candidate", true], ["Summary delta", true], ["Paired delta", true], ["Paired CI", true], ["p", true], ["Verdict", false]] as const;

/** Per compared experiment: metric deltas with their tests, then segment, slice, path and case changes. Empty without a comparison. */
export function comparisonTables(result: EvalResult, caseLimit = 20): readonly TableView[] {
  const comparison = result.comparison;
  if (comparison === undefined) return [];
  const { baselineRunId, candidateRunId, settings } = comparison;
  const entries = Object.values(comparison.experiments);
  return entries.flatMap((compared) => {
    const suffix = entries.length > 1 ? ` (${compared.candidate})` : "";
    const notes = [
      `${compared.pairs.paired} paired cases, ${compared.pairs.baselineOnly} only in the baseline, ${compared.pairs.candidateOnly} only in the candidate.`,
      `Test ${settings.test}, alpha ${settings.alpha}, clustered by ${settings.cluster}.`,
      ...comparison.compatible.warnings,
    ];
    const tables: TableView[] = [
      table(`Comparison: ${baselineRunId}/${compared.baseline} to ${candidateRunId}/${compared.candidate}`, DELTA_COLUMNS, compared.metrics.map((delta) => deltaCells(result, delta)), notes),
    ];
    const segmentRows = Object.entries(compared.segments).flatMap(([segment, deltas]) => deltas.map((delta) => [segment, ...deltaCells(result, delta)]));
    if (segmentRows.length > 0) tables.push(table(`Comparison by segment${suffix}`, [["Segment", false], ...DELTA_COLUMNS], segmentRows));
    const sliceRows = Object.entries(compared.slices).flatMap(([slice, groups]) =>
      Object.entries(groups).flatMap(([key, deltas]) => deltas.map((delta) => [`${slice}=${key}`, ...deltaCells(result, delta)])),
    );
    if (sliceRows.length > 0) tables.push(table(`Comparison by slice${suffix}`, [["Slice", false], ...DELTA_COLUMNS], sliceRows));
    const paths = [...compared.paths].sort((a, b) => (a.f1.summaryDelta ?? 0) - (b.f1.summaryDelta ?? 0) || compareCodeUnits(a.pattern, b.pattern));
    if (paths.length > 0) {
      tables.push(table(`Path changes${suffix}`, [["Path", false], ...DELTA_COLUMNS], paths.map((path) => [path.pattern, ...deltaCells(result, path.f1)])));
    }
    const changed = [
      ...compared.cases.regressed.map((delta) => ({ delta, change: "regressed" })),
      ...compared.cases.improved.map((delta) => ({ delta, change: "improved" })),
    ];
    const caseRows = [
      ...compared.cases.newlyErrored.map((row) => [row.caseId, String(row.epoch), "outcome", row.baseline, row.candidate, "newly errored"]),
      ...compared.cases.fixed.map((row) => [row.caseId, String(row.epoch), "outcome", row.baseline, row.candidate, "fixed"]),
      ...changed.map(({ delta, change }) => {
        const format = metricInfo(result, delta.metric).format;
        return [delta.caseId, String(delta.epoch), metricInfo(result, delta.metric).label, formatMetric(delta.baseline, format), formatMetric(delta.candidate, format), change];
      }),
    ];
    if (caseRows.length > 0) {
      const caseNotes = caseRows.length > caseLimit ? [`${caseRows.length - caseLimit} more changed cases not shown.`] : [];
      tables.push(table(`Changed cases${suffix}`, [["Case", false], ["Epoch", true], ["Metric", false], ["Baseline", true], ["Candidate", true], ["Change", false]], caseRows.slice(0, caseLimit), caseNotes));
    }
    return tables;
  });
}

function calibrationRow(group: string, stats: CalibrationStats): string[] {
  const threshold = stats.threshold;
  const accepted = threshold === null ? 0 : stats.scores.filter((score) => score.confidence >= threshold).reduce((sum, score) => sum + score.count, 0);
  return [
    group,
    formatCount(stats.support),
    formatNumber(stats.ece),
    formatNumber(stats.mce),
    formatNumber(stats.brier),
    formatNumber(stats.auroc),
    formatNumber(stats.averagePrecision),
    formatPercent(stats.coverageAtPrecision),
    formatPercent(stats.coverageAtAccuracy["0.99"] ?? null),
    formatNumber(stats.threshold),
    formatCount(accepted),
    formatCount(stats.groundTruth),
  ];
}

/** Per experiment: calibration overall and per group. Empty without a calibration section. */
export function calibrationTables(result: EvalResult): readonly TableView[] {
  const calibration = result.calibration;
  if (calibration === undefined) return [];
  return Object.entries(calibration.experiments).flatMap(([experiment, summary]) => {
    const groups = Object.entries(summary.groups).sort(([a], [b]) => compareCodeUnits(a, b));
    const target = formatPercent(calibration.targetPrecision);
    const main = table(
      titled(result, "Calibration", experiment),
      [[calibration.by, false], ["Support", true], ["ECE", true], ["MCE", true], ["Brier", true], ["AUROC", true], ["AP", true], [`Coverage at ${target}`, true], ["Coverage at 99% accuracy", true], ["Auto-accept threshold", true], ["Accepted support", true], ["Ground truth", true]],
      [calibrationRow("overall", summary.overall), ...groups.map(([group, stats]) => calibrationRow(group, stats))],
      [`${summary.overall.support} of ${summary.graded} produced fields carried a confidence (${formatPercent(summary.graded === 0 ? null : summary.overall.support / summary.graded)} confidence coverage). ${summary.omissions} omissions. Auto-accept target ${target}, minimum support ${calibration.minSupport}.`],
    );
    const targets = table(
      titled(result, "Accuracy at coverage and coverage at accuracy", experiment),
      [[calibration.by, false], ["Target", true], ["Accuracy at coverage", true], ["Coverage at accuracy", true]],
      [["overall", summary.overall] as const, ...groups].flatMap(([group, stats]) =>
        [...new Set([...Object.keys(stats.accuracyAtCoverage), ...Object.keys(stats.coverageAtAccuracy)])].sort((a, b) => Number(a) - Number(b)).map((target) => [group, formatPercent(Number(target)), formatPercent(stats.accuracyAtCoverage[target] ?? null), formatPercent(stats.coverageAtAccuracy[target] ?? null)])),
    );
    return [main, targets];
  });
}

function groundingRow(name: string, counts: GroundingScore): string[] {
  return [name, ...[counts.predicted, counts.labelled, counts.correct, counts.supported, counts.grounded, counts.withEvidence, counts.hallucinated].map(formatCount), ...[counts.groundedPrecision, counts.groundedRecall, counts.groundedF1].map(formatPercent)];
}

/** Grounding counts and scores overall, per path and per segment. */
export function groundingTables(result: EvalResult): readonly TableView[] {
  const grounding = result.grounding;
  if (grounding === undefined) return [];
  const columns = [["Predicted", true], ["Labelled", true], ["Correct", true], ["Supported", true], ["Grounded", true], ["With evidence", true], ["Hallucinated", true], ["Grounded precision", true], ["Grounded recall", true], ["Grounded F1", true]] as const;
  return Object.entries(grounding.experiments).flatMap(([experiment, summary]) => [
    table(titled(result, "Grounding", experiment), [["Path", false], ...columns],
      [groundingRow("overall", summary.overall), ...Object.entries(summary.patterns).sort(([a], [b]) => compareCodeUnits(a, b)).map(([pattern, counts]) => groundingRow(pattern, counts))],
      [`${grounding.level} level, IoU ${grounding.iou}.`, `Labelled cases scored: ${summary.cases.labelled}. Unlabelled cases not scored: ${summary.cases.unlabelled}.`]),
    ...(Object.keys(summary.segments).length === 0 ? [] : [table(titled(result, "Grounding by segment", experiment), [["Segment", false], ...columns], Object.entries(summary.segments).sort(([a], [b]) => compareCodeUnits(a, b)).map(([segment, counts]) => groundingRow(segment, counts)))]),
  ]);
}

/** Every gate check with its verdict. Undefined without a gate section. */
export function gateTable(result: EvalResult): TableView | undefined {
  const gate = result.gate;
  if (gate === undefined) return undefined;
  const failed = gate.checks.filter((check) => check.status === "fail").length;
  const rows = gate.checks.map((check) => {
    const format = metricInfo(result, check.metric).format;
    const bounds = [check.min === undefined ? undefined : `min ${formatMetric(check.min, format)}`, check.max === undefined ? undefined : `max ${formatMetric(check.max, format)}`]
      .filter((bound) => bound !== undefined)
      .join(", ");
    return [check.status, check.kind, check.experiment, check.target, formatMetric(check.value, format), bounds, check.kind === "run" && check.status === "fail" ? `incomplete run: ${check.message}` : check.message];
  });
  return table(
    `Gate: ${gate.pass ? "pass" : "fail"}`,
    [["Status", false], ["Kind", false], ["Experiment", false], ["Check", false], ["Value", true], ["Bound", false], ["Message", false]],
    rows,
    [`${gate.checks.length} checks, ${failed} failed.`],
  );
}
