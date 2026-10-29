import {
  EvalSpecError,
  compareCodeUnits,
  type OmittedLeaves,
  type CalibrationReport,
  type CalibrationStats,
  type CalibrationSummary,
  type ConfidenceCount,
  type EvalResult,
} from "../index.js";

/** Calibration grouping, binning and empirical acceptance requirements. */
export interface CalibrationOptions {
  readonly bins?: number;
  readonly by?: CalibrationReport["by"];
  readonly targetPrecision?: number;
  readonly minSupport?: number;
}
function invalid(message: string): never {
  throw new EvalSpecError([{ code: "invalid-rule", path: "calibration", message }]);
}
function scoreCounts(scores: readonly ConfidenceCount[]): ConfidenceCount[] {
  const map = new Map<number, { count: number; correct: number }>();
  for (const s of scores) {
    const before = map.get(s.confidence) ?? { count: 0, correct: 0 };
    map.set(s.confidence, { count: before.count + s.count, correct: before.correct + s.correct });
  }
  return [...map].sort(([a], [b]) => b - a).map(([confidence, counts]) => ({ confidence, ...counts }));
}
function clopperPearsonLowerBoundMeetsTarget(correct: number, count: number, target: number): boolean {
  if (correct === 0) return false;
  if (target === 1) return false;
  let logCombination = 0;
  for (let i = 1; i <= correct; i++) logCombination += Math.log(count - i + 1) - Math.log(i);
  let logTerm = logCombination + correct * Math.log(target) + (count - correct) * Math.log1p(-target);
  let tail = Math.exp(logTerm);
  for (let k = correct + 1; k <= count; k++) {
    logTerm += Math.log(count - k + 1) - Math.log(k) + Math.log(target) - Math.log1p(-target);
    tail += Math.exp(logTerm);
    if (tail > 0.05) return false;
  }
  return tail <= 0.05;
}
function binIndex(confidence: number, count: number): number {
  let low = 0;
  let high = count;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (confidence >= middle / count) low = middle;
    else high = middle;
  }
  return low;
}
function tieAwareWins(correct: number, count: number, negativesBelow: number): number {
  return correct * (negativesBelow + (count - correct) / 2);
}
function stats(raw: readonly ConfidenceCount[], groundTruth: number, options: Required<CalibrationOptions>): CalibrationStats {
  const scores = scoreCounts(raw);
  const bins: {
    lower: number;
    upper: number;
    count: number;
    correct: number;
    confidenceSum: number;
    confidenceSquaredSum: number;
    correctConfidenceSum: number;
  }[] = Array.from({ length: options.bins }, (_, i) => ({
    lower: i / options.bins,
    upper: (i + 1) / options.bins,
    count: 0,
    correct: 0,
    confidenceSum: 0,
    confidenceSquaredSum: 0,
    correctConfidenceSum: 0,
  }));
  let support = 0;
  let correct = 0;
  let accepted = 0;
  let hits = 0;
  let ap = 0;
  let wins = 0;
  for (const s of scores) {
    const bin = bins[binIndex(s.confidence, options.bins)]!;
    bin.count += s.count;
    bin.correct += s.correct;
    bin.confidenceSum += s.confidence * s.count;
    bin.confidenceSquaredSum += s.confidence ** 2 * s.count;
    bin.correctConfidenceSum += s.confidence * s.correct;
    support += s.count;
    correct += s.correct;
  }
  const riskCoverage = scores.map((s) => {
    const negativesBelow = support - correct - (accepted - hits) - (s.count - s.correct);
    wins += tieAwareWins(s.correct, s.count, negativesBelow);
    accepted += s.count;
    hits += s.correct;
    ap += (s.correct * hits) / accepted;
    return { threshold: s.confidence, coverage: accepted / support, accuracy: hits / accepted };
  });
  const eligible = (precision: number) =>
    riskCoverage.filter((point) => point.coverage * support + 1e-9 >= options.minSupport && point.accuracy >= precision).at(-1);
  const threshold = riskCoverage
    .filter((point) => {
      const count = Math.round(point.coverage * support);
      return (
        count >= options.minSupport &&
        clopperPearsonLowerBoundMeetsTarget(Math.round((point.accuracy ?? 0) * count), count, options.targetPrecision)
      );
    })
    .at(-1);
  const gaps = bins
    .filter((b) => b.count > 0)
    .map((b) => ({ gap: Math.abs(b.correct / b.count - b.confidenceSum / b.count), count: b.count }));
  const accuracyAtCoverage: Record<string, number | null> = {};
  const coverageAtAccuracy: Record<string, number | null> = {};
  for (const target of [0.5, 0.8, 0.9, 0.95, 0.99, 1]) {
    accuracyAtCoverage[String(target)] = riskCoverage.find((point) => point.coverage >= target)?.accuracy ?? null;
    coverageAtAccuracy[String(target)] = eligible(target)?.coverage ?? (support === 0 ? null : 0);
  }
  return {
    support,
    groundTruth,
    bins,
    scores,
    ece: support === 0 ? null : gaps.reduce((sum, g) => sum + g.gap * g.count, 0) / support,
    mce: gaps.length === 0 ? null : Math.max(...gaps.map((g) => g.gap)),
    brier:
      support === 0 ? null : bins.reduce((sum, b) => sum + b.confidenceSquaredSum - 2 * b.correctConfidenceSum + b.correct, 0) / support,
    auroc: correct === 0 || correct === support ? null : wins / (correct * (support - correct)),
    averagePrecision: groundTruth === 0 ? null : ap / groundTruth,
    riskCoverage,
    coverageAtPrecision: threshold?.coverage ?? (support === 0 ? null : 0),
    threshold: threshold?.threshold ?? null,
    accuracyAtCoverage,
    coverageAtAccuracy,
  };
}
function configured(options: CalibrationOptions): Required<CalibrationOptions> {
  const o = {
    bins: options.bins ?? 10,
    by: options.by ?? "pattern",
    targetPrecision: options.targetPrecision ?? 0.99,
    minSupport: options.minSupport ?? 5,
  };
  if (
    !Number.isSafeInteger(o.bins) ||
    o.bins < 1 ||
    !Number.isSafeInteger(o.minSupport) ||
    o.minSupport < 1 ||
    !Number.isFinite(o.targetPrecision) ||
    o.targetPrecision <= 0 ||
    o.targetPrecision > 1
  )
    invalid("bins and minSupport must be positive integers; targetPrecision must be in (0, 1]");
  return o;
}
function erroredOmissions(omitted: OmittedLeaves, by: CalibrationReport["by"], types: ReadonlyMap<string, string>): [string, number][] {
  if (by === "segment") return Object.entries(omitted.segments).map(([segment, count]) => [segment, count.fields]);
  if (by === "path") return [];
  return Object.entries(omitted.paths).map(([pattern, count]) => [
    by === "fieldType" ? (types.get(pattern) ?? "unknown") : pattern,
    count.fields,
  ]);
}
/**
 * Calibrate exact confidence counts. Auto-accept requires a one-sided 95% Clopper-Pearson lower bound.
 * An errored case's omissions count toward `groundTruth` overall and in pattern, field-type and segment groups;
 * `by: "path"` groups count only scored cases, because an errored case has no concrete paths.
 */
export function calibrate(result: EvalResult, options: CalibrationOptions = {}): CalibrationReport {
  const o = configured(options);
  const experiments: Record<string, CalibrationSummary> = {};
  const types = new Map(result.run.spec.fields.map((f) => [f.pattern, f.type]));
  for (const experiment of Object.keys(result.summary).sort(compareCodeUnits)) {
    const all: ConfidenceCount[] = [];
    const grouped = new Map<string, { scores: ConfidenceCount[]; groundTruth: number }>();
    const groupOf = (key: string) => {
      const group = grouped.get(key) ?? { scores: [], groundTruth: 0 };
      grouped.set(key, group);
      return group;
    };
    let graded = 0;
    let omissions = 0;
    let groundTruth = 0;
    for (const row of result.cases) {
      if (row.experiment !== experiment) continue;
      if (row.outcome === "errored") {
        omissions += row.omitted.fields;
        groundTruth += row.omitted.fields;
        for (const [key, fields] of erroredOmissions(row.omitted, o.by, types)) groupOf(key).groundTruth += fields;
        continue;
      }
      if (row.outcome !== "scored") continue;
      for (const field of row.score.fields) {
        const group = groupOf(o.by === "fieldType" ? (types.get(field.pattern) ?? "unknown") : field[o.by]);
        if (field.status !== "hallucination") {
          group.groundTruth++;
          groundTruth++;
        }
        if (field.status === "omission") {
          omissions++;
          continue;
        }
        graded++;
        if (field.confidence === undefined) continue;
        if (!Number.isFinite(field.confidence) || field.confidence < 0 || field.confidence > 1)
          invalid(`confidence for ${field.path} must be in [0, 1]`);
        const entry = { confidence: field.confidence, count: 1, correct: field.status === "match" ? 1 : 0 };
        group.scores.push(entry);
        all.push(entry);
      }
    }
    experiments[experiment] = {
      graded,
      omissions,
      overall: stats(all, groundTruth, o),
      groups: Object.fromEntries(
        [...grouped].sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, group]) => [key, stats(group.scores, group.groundTruth, o)]),
      ),
    };
  }
  return { ...o, experiments };
}
/** Merge reports without losing score ties, AUROC or average precision. */
export function mergeCalibration(a: CalibrationReport, b: CalibrationReport): CalibrationReport {
  if (a.bins !== b.bins || a.by !== b.by || a.targetPrecision !== b.targetPrecision || a.minSupport !== b.minSupport)
    invalid("calibration settings must match before merging");
  for (const report of [a, b])
    for (const summary of Object.values(report.experiments)) {
      if (!Number.isSafeInteger(summary.omissions) || summary.omissions < 0)
        invalid("omissions must be present and non-negative before merging");
    }
  const o = configured(a);
  const experiments: Record<string, CalibrationSummary> = {};
  for (const id of [...new Set([...Object.keys(a.experiments), ...Object.keys(b.experiments)])].sort(compareCodeUnits)) {
    const left = a.experiments[id];
    const right = b.experiments[id];
    const parts = [left, right].filter((part): part is CalibrationSummary => part !== undefined);
    const groups: Record<string, CalibrationStats> = {};
    for (const key of [...new Set(parts.flatMap((part) => Object.keys(part.groups)))].sort(compareCodeUnits)) {
      const members = parts.flatMap((part) => part.groups[key] ?? []);
      groups[key] = stats(
        members.flatMap((member) => member.scores),
        members.reduce((sum, member) => sum + member.groundTruth, 0),
        o,
      );
    }
    experiments[id] = {
      graded: parts.reduce((sum, p) => sum + p.graded, 0),
      omissions: parts.reduce((sum, p) => sum + p.omissions, 0),
      overall: stats(
        parts.flatMap((part) => part.overall.scores),
        parts.reduce((sum, p) => sum + p.overall.groundTruth, 0),
        o,
      ),
      groups,
    };
  }
  return { ...o, experiments };
}
/** Add calibration through the runner's result sections hook. */
export function calibrationSection(options: CalibrationOptions = {}): (result: EvalResult) => { calibration: CalibrationReport } {
  return (result) => ({ calibration: calibrate(result, options) });
}
