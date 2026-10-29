import {
  compareCodeUnits,
  groundingRule,
  isGrounded,
  supportsLocation,
  type EvalCase,
  type EvalResult,
  type GroundingReport,
  type GroundingScore,
  type GroundingSummary,
} from "../index.js";

/** Evidence support requirements and optional external expected locations. */
export interface GroundingOptions {
  readonly iou?: number;
  readonly level?: "box" | "page";
  readonly locations?: Readonly<Record<string, EvalCase["locations"]>>;
}
interface Counts {
  predicted: number;
  labelled: number;
  correct: number;
  supported: number;
  grounded: number;
  withEvidence: number;
  hallucinated: number;
}
function empty(): Counts {
  return { predicted: 0, labelled: 0, correct: 0, supported: 0, grounded: 0, withEvidence: 0, hallucinated: 0 };
}
function score(counts: Counts): GroundingScore {
  const predicted = counts.predicted;
  const relevant = counts.labelled;
  return {
    ...counts,
    groundedPrecision: predicted === 0 ? null : counts.grounded / predicted,
    groundedRecall: relevant === 0 ? null : counts.grounded / relevant,
    groundedF1: predicted + relevant === 0 ? null : (2 * counts.grounded) / (predicted + relevant),
  };
}
function countUnemittedLabels(
  locations: EvalCase["locations"],
  seen: ReadonlySet<string>,
  fields: EvalResult["run"]["spec"]["fields"],
  counts: Counts,
  patterns: Map<string, Counts>,
  segments: Map<string, Counts>,
): void {
  for (const [path, expected] of Object.entries(locations ?? {})) {
    if (expected.length === 0 || seen.has(path)) continue;
    counts.labelled++;
    const info = fields.find((f) => f.pattern === path || f.pattern === path.replace(/\[\d+\]/gu, "[]"));
    const pattern = patterns.get(info?.pattern ?? path) ?? empty();
    pattern.labelled++;
    patterns.set(info?.pattern ?? path, pattern);
    const segment = segments.get(info?.segment ?? "unknown") ?? empty();
    segment.labelled++;
    segments.set(info?.segment ?? "unknown", segment);
  }
}
/** Grade correct predictions whose evidence supports a labelled expected page or box. */
export function grounding(result: EvalResult, options: GroundingOptions = {}): GroundingReport {
  const { iou, level } = groundingRule(options);
  const experiments: Record<string, GroundingSummary> = {};
  for (const experiment of Object.keys(result.summary).sort(compareCodeUnits)) {
    const counts = empty();
    const patterns = new Map<string, Counts>();
    const segments = new Map<string, Counts>();
    let labelled = 0;
    let unlabelled = 0;
    for (const row of result.cases) {
      if (row.experiment !== experiment || row.outcome === "skipped") continue;
      const locations = options.locations?.[row.caseId] ?? row.locations;
      const hasLocations =
        Object.values(locations ?? {}).some((v) => v.length > 0) ||
        (row.outcome === "scored" && row.score.fields.some((f) => (f.locations?.length ?? 0) > 0));
      if (!hasLocations) {
        unlabelled++;
        continue;
      }
      labelled++;
      const seen = new Set<string>();
      if (row.outcome === "scored")
        for (const field of row.score.fields) {
          const expected = locations?.[field.path] ?? field.locations ?? [];
          if (expected.length === 0 && field.status !== "hallucination") continue;
          seen.add(field.path);
          const evidence = field.evidence ?? [];
          const supported = supportsLocation(evidence, expected, { iou, level });
          const grounded = isGrounded(field, expected, { iou, level });
          const pattern = patterns.get(field.pattern) ?? empty();
          const segment = segments.get(field.segment) ?? empty();
          patterns.set(field.pattern, pattern);
          segments.set(field.segment, segment);
          for (const target of [counts, pattern, segment]) {
            if (expected.length > 0 && field.status !== "hallucination") target.labelled++;
            if (field.status === "match") target.correct++;
            if (supported) target.supported++;
            if (grounded) target.grounded++;
            if (field.status !== "omission") target.predicted++;
            if (field.status !== "omission" && evidence.length > 0) target.withEvidence++;
            if (field.status === "hallucination" && evidence.length > 0) target.hallucinated++;
          }
        }
      countUnemittedLabels(locations, seen, result.run.spec.fields, counts, patterns, segments);
    }
    experiments[experiment] = {
      cases: { labelled, unlabelled },
      overall: score(counts),
      patterns: Object.fromEntries([...patterns].sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, value]) => [key, score(value)])),
      segments: Object.fromEntries([...segments].sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, value]) => [key, score(value)])),
    };
  }
  return { iou, level, experiments };
}
/** Add grounding through the runner's result sections hook. */
export function groundingSection(options: GroundingOptions = {}): (result: EvalResult) => { grounding: GroundingReport } {
  return (result) => ({ grounding: grounding(result, options) });
}
