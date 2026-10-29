import type { EvalCase, TagValue } from "../case.js";
import type { UsageInfo } from "../extractor.js";
import type { GateResult } from "../gate/types.js";
import type { JsonValue } from "../json.js";
import type { MetricInfo } from "../metrics/types.js";
import type { CaseScore, Prf, StatusCounts } from "../score/types.js";
import type { SpecInfo } from "../spec/types.js";
import type { CalibrationReport, GroundingReport, RunComparison } from "./sections.js";

/** The `format` member of every eval result. */
export const RESULT_FORMAT = "docture-eval-result";
/** The result format version this package reads and writes. */
export const RESULT_VERSION = 1;

export interface RunInfo {
  readonly id: string;
  readonly status: "in-progress" | "complete" | "aborted";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly git?: { readonly branch: string; readonly sha: string; readonly dirty: boolean };
  readonly dataset: { readonly id: string; readonly size: number; readonly fingerprint: string; readonly selection?: JsonValue };
  readonly spec: SpecInfo;
  readonly experiments: readonly { readonly id: string; readonly configHash: string; readonly config?: JsonValue }[];
  readonly epochs: number;
  /** The run this one was re-scored from by `rescore`, which never changes the source run. */
  readonly rescoredFrom?: string;
}

/** A number of omitted expected leaves and their summed weight. */
export interface OmittedCount {
  readonly fields: number;
  readonly weight: number;
}

/** How an errored case's expected leaves count as omissions at run scope. Compute it with `omittedOf(spec.score(expected, undefined))`. */
export interface OmittedLeaves extends OmittedCount {
  /** Keyed by segment. */
  readonly segments: Readonly<Record<string, OmittedCount>>;
  /** Keyed by path pattern, such as `lineItems[].amount`. */
  readonly paths: Readonly<Record<string, OmittedCount>>;
}

interface CaseBase {
  readonly caseId: string;
  /** Content hash of the case (documents, expected values, tags and params), so resume can tell an edited case from the one that ran. */
  readonly caseFingerprint?: string;
  readonly experiment: string;
  /** The experiment's `configHash` when the row ran, so resume and comparison can tell rows from an edited experiment apart. */
  readonly configHash?: string;
  readonly epoch: number;
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly group?: string;
  /** The case's expected locations, kept so a labelled case counts as labelled even when it produced no fields. */
  readonly locations?: EvalCase["locations"];
  /** Per-case values of every metric with `perCase`, keyed by metric id, so run comparison can pair cases without the metric's code. */
  readonly values?: MetricValues;
  /** Slice values recorded when the case ran, keyed by slice name. */
  readonly slices?: Readonly<Record<string, TagValue>>;
  readonly usage?: UsageInfo;
  readonly method?: string;
  readonly fallback?: boolean;
  readonly diagnostics?: JsonValue;
  readonly startedAt: string;
  readonly ms: number;
}

export interface ScoredCase extends CaseBase {
  readonly outcome: "scored";
  readonly expected: JsonValue;
  readonly actual: JsonValue;
  readonly score: CaseScore;
}

/** A case whose processor failed. */
export interface ErroredCase extends CaseBase {
  readonly outcome: "errored";
  readonly expected: JsonValue;
  readonly error: { readonly name: string; readonly code?: string; readonly message: string };
  readonly omitted: OmittedLeaves;
}

/** A case the processor declared out of scope. */
export interface SkippedCase extends CaseBase {
  readonly outcome: "skipped";
  readonly reason: string;
}

/** One case × experiment × epoch. */
export type CaseResult = ScoredCase | ErroredCase | SkippedCase;

/** Metric values keyed by metric id. `null` means there was nothing to measure. */
export type MetricValues = Readonly<Record<string, number | null>>;

/** Scores of all fields sharing a path pattern or field type at run scope: pooled over scored cases, with an errored case's expected leaves as omissions. */
export interface FieldGroupSummary extends Prf {
  readonly counts: StatusCounts;
  readonly meanSimilarity: number | null;
}

/** Metric spread across epochs. */
export interface EpochSummary {
  readonly epochs: number;
  readonly metrics: Readonly<Record<string, { readonly values: readonly (number | null)[]; readonly mean: number | null; readonly stdev: number | null }>>;
}

/** Everything summarized for one experiment. */
export interface Summary {
  readonly cases: { readonly total: number; readonly scored: number; readonly errored: number; readonly skipped: number };
  readonly overall: MetricValues;
  /** Counts include an errored case's expected leaves as omissions. Metrics carry every precision, recall and F1 scope. */
  readonly segments: Readonly<Record<string, { readonly counts: StatusCounts; readonly weighted: StatusCounts; readonly metrics: MetricValues }>>;
  /** Keyed by slice name, then slice value. */
  readonly slices: Readonly<Record<string, Readonly<Record<string, { readonly cases: number; readonly metrics: MetricValues }>>>>;
  readonly paths: Readonly<Record<string, FieldGroupSummary>>;
  readonly fieldTypes: Readonly<Record<string, FieldGroupSummary>>;
  readonly epochs?: EpochSummary;
}

/** The common, versioned output of an evaluation. Every reporter, the gate and run comparison read only this. */
export interface EvalResult {
  readonly format: typeof RESULT_FORMAT;
  readonly version: typeof RESULT_VERSION;
  readonly run: RunInfo;
  readonly metrics: readonly MetricInfo[];
  /** Keyed by experiment id. */
  readonly summary: Readonly<Record<string, Summary>>;
  readonly cases: readonly CaseResult[];
  readonly calibration?: CalibrationReport;
  readonly grounding?: GroundingReport;
  readonly comparison?: RunComparison;
  readonly gate?: GateResult;
  readonly warnings: readonly string[];
  readonly extensions: Readonly<Record<string, JsonValue>>;
}

/** An optional analysis, such as calibration or grounding, applied before the gate and reporters see the result. */
export type ResultSection = (result: EvalResult) => Partial<Pick<EvalResult, "calibration" | "grounding">>;
