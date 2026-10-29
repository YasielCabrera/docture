import type { TagValue } from "../case.js";
import type { StatusCounts } from "../score/types.js";

/**
 * One confidence bin. Every member is a sum, so bins from separate runs merge by
 * addition and the result does not depend on case order.
 */
export interface CalibrationBin {
  /** Inclusive lower bound of the bin's confidence range. */
  readonly lower: number;
  /** Exclusive upper bound, inclusive for the last bin. */
  readonly upper: number;
  readonly count: number;
  /** Fields in the bin whose status is `match`. */
  readonly correct: number;
  readonly confidenceSum: number;
  readonly confidenceSquaredSum: number;
  /** Sum of confidence over correct fields, for the Brier score. */
  readonly correctConfidenceSum: number;
}

/** A point on the risk-coverage curve: accepting fields at or above `threshold`. Risk is `1 - accuracy`. */
export interface CoveragePoint {
  readonly threshold: number;
  readonly coverage: number;
  readonly accuracy: number | null;
}

/** How many fields carried one exact confidence value, and how many of them were correct. */
export interface ConfidenceCount {
  readonly confidence: number;
  readonly count: number;
  readonly correct: number;
}

/** Calibration of one group of fields. Everything except `scores` and `groundTruth` is derived from them, so groups from separate runs merge exactly. */
export interface CalibrationStats {
  /** Graded fields that carried a confidence. */
  readonly support: number;
  /**
   * Expected fields in the group whether predicted or not: match, mismatch and omission.
   * The denominator of confidence-ranked average precision, as in DocILE.
   */
  readonly groundTruth: number;
  /** One entry per distinct confidence, highest first. */
  readonly scores: readonly ConfidenceCount[];
  readonly bins: readonly CalibrationBin[];
  /** Expected calibration error. */
  readonly ece: number | null;
  /** Maximum calibration error. */
  readonly mce: number | null;
  readonly brier: number | null;
  readonly auroc: number | null;
  /** Confidence-ranked average precision over `groundTruth`. */
  readonly averagePrecision: number | null;
  readonly riskCoverage: readonly CoveragePoint[];
  /** Accuracy of the most confident fields that reach each target coverage, keyed by the target: `"0.5"`, `"0.8"`, `"0.9"`, `"0.95"`, `"0.99"` and `"1"`. */
  readonly accuracyAtCoverage: Readonly<Record<string, number | null>>;
  /** Largest coverage whose accepted fields reach each target accuracy with at least `minSupport` fields, keyed by the same targets. */
  readonly coverageAtAccuracy: Readonly<Record<string, number | null>>;
  /** Share of fields auto-accepted at the report's target precision. */
  readonly coverageAtPrecision: number | null;
  /** Lowest confidence threshold whose accepted fields reach the target precision with at least `minSupport` fields. */
  readonly threshold: number | null;
}

/** Calibration for one experiment. Coverage of the confidence signal itself is `overall.support / graded`. */
export interface CalibrationSummary {
  /** Fields the processor produced (match, mismatch and hallucination), with or without a confidence. */
  readonly graded: number;
  /** Expected fields the processor did not produce, errored cases included. */
  readonly omissions: number;
  readonly overall: CalibrationStats;
  /** Keyed by the report's `by` dimension. */
  readonly groups: Readonly<Record<string, CalibrationStats>>;
}

/** Confidence calibration of a run, per experiment. Filled by `@docture/eval/calibration`. */
export interface CalibrationReport {
  readonly bins: number;
  /** How groups are keyed. `path` groups leave errored cases out of `groundTruth`, because an errored case records no concrete paths. */
  readonly by: "path" | "pattern" | "fieldType" | "segment";
  readonly targetPrecision: number;
  readonly minSupport: number;
  readonly experiments: Readonly<Record<string, CalibrationSummary>>;
}

/** Grounding counts for a group of fields. Grounded means correct and supported by evidence at the expected location. */
export interface GroundingCounts {
  /** Fields the processor produced: match, mismatch and hallucination. */
  readonly predicted: number;
  /** Fields with an expected location. */
  readonly labelled: number;
  readonly correct: number;
  readonly supported: number;
  readonly grounded: number;
  readonly withEvidence: number;
  /** Actual values with evidence but no expected value. */
  readonly hallucinated: number;
}

/** Grounding counts with grounded precision (over `predicted`), recall (over `labelled`) and F1. */
export interface GroundingScore extends GroundingCounts {
  readonly groundedPrecision: number | null;
  readonly groundedRecall: number | null;
  readonly groundedF1: number | null;
}

/** Grounding for one experiment. */
export interface GroundingSummary {
  readonly cases: { readonly labelled: number; readonly unlabelled: number };
  readonly overall: GroundingScore;
  /** Keyed by path pattern. */
  readonly patterns: Readonly<Record<string, GroundingScore>>;
  /** Keyed by segment. */
  readonly segments: Readonly<Record<string, GroundingScore>>;
}

/** Grounding of a run, per experiment. Filled by `@docture/eval/grounding`. */
export interface GroundingReport {
  readonly iou: number;
  readonly level: "box" | "page";
  readonly experiments: Readonly<Record<string, GroundingSummary>>;
}

/**
 * What run comparison concluded about one metric.
 *
 * - `improved`, `regressed`: the test is significant and its interval excludes 0 on the metric's good or bad side.
 * - `unchanged`: every paired value is identical.
 * - `inconclusive`: tested and not significant.
 * - `insufficient`: too few paired cases or clusters to test.
 * - `not-tested`: the metric has no per-case values to pair.
 * - `incomparable`: the metric has no value in one run.
 */
export type DeltaVerdict = "improved" | "regressed" | "unchanged" | "inconclusive" | "insufficient" | "not-tested" | "incomparable";

/** The change in one metric between two experiments. */
export interface MetricDelta {
  readonly metric: string;
  /** The metric's summary value in each run. */
  readonly baseline: number | null;
  readonly candidate: number | null;
  /** Candidate summary minus baseline summary. What a dashboard shows; not what the test measured. */
  readonly summaryDelta: number | null;
  /** Mean of candidate minus baseline over paired cases: the quantity `ci`, `p` and `verdict` describe. */
  readonly pairedDelta: number | null;
  /** Confidence interval of `pairedDelta` at `1 - alpha`. */
  readonly ci: readonly [number, number] | null;
  readonly p: number | null;
  readonly test: "bootstrap" | "mcnemar" | "none";
  readonly verdict: DeltaVerdict;
  /** Paired cases behind `pairedDelta`. */
  readonly n: number;
}

/** One case and epoch whose per-case metric value changed. */
export interface CaseDelta {
  readonly caseId: string;
  readonly epoch: number;
  readonly metric: string;
  readonly baseline: number;
  readonly candidate: number;
}

/** One case and epoch whose outcome changed between the runs. */
export interface OutcomeChange {
  readonly caseId: string;
  readonly epoch: number;
  readonly baseline: "scored" | "errored" | "skipped";
  readonly candidate: "scored" | "errored" | "skipped";
}

/** The change in one path pattern's scores, with its paired F1 test. */
export interface PathDelta {
  readonly pattern: string;
  /** Status counts pooled over each run's scored cases. */
  readonly counts: { readonly baseline: StatusCounts; readonly candidate: StatusCounts };
  readonly f1: MetricDelta;
}

/** One baseline experiment against one candidate experiment. */
export interface ExperimentComparison {
  /** Experiment id in the baseline run. */
  readonly baseline: string;
  /** Experiment id in the candidate run. */
  readonly candidate: string;
  /** Case and epoch rows present in both experiments, and in only one. */
  readonly pairs: { readonly paired: number; readonly baselineOnly: number; readonly candidateOnly: number };
  readonly metrics: readonly MetricDelta[];
  /** Keyed by segment. */
  readonly segments: Readonly<Record<string, readonly MetricDelta[]>>;
  /** Keyed by slice name, then slice value. */
  readonly slices: Readonly<Record<string, Readonly<Record<string, readonly MetricDelta[]>>>>;
  readonly paths: readonly PathDelta[];
  readonly cases: {
    readonly regressed: readonly CaseDelta[];
    readonly improved: readonly CaseDelta[];
    /** Scored or skipped in the baseline, errored in the candidate. */
    readonly newlyErrored: readonly OutcomeChange[];
    /** Errored in the baseline, scored in the candidate. */
    readonly fixed: readonly OutcomeChange[];
  };
}

/** A baseline run against a candidate run, every compared experiment included. Filled by `@docture/eval/compare`. */
export interface RunComparison {
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly settings: {
    readonly test: "bootstrap" | "mcnemar" | "auto";
    readonly resamples: number;
    readonly seed: string;
    readonly alpha: number;
    readonly cluster: "group" | "case";
  };
  readonly compatible: { readonly dataset: boolean; readonly spec: boolean; readonly warnings: readonly string[] };
  /** Keyed by candidate experiment id. */
  readonly experiments: Readonly<Record<string, ExperimentComparison>>;
}

/** A slice filter in a gate threshold, such as `{ rendition: "scan-lq" }`. */
export type SliceFilter = Readonly<Record<string, TagValue>>;
