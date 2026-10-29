import type { CaseResult } from "../result/types.js";
import type { CalibrationSummary, GroundingSummary } from "../result/sections.js";

/** How a metric value is displayed. */
export type MetricFormat = "ratio" | "usd" | "ms" | "count" | "number";

/** The serializable description of a metric, stored in every result. */
export interface MetricInfo {
  readonly id: string;
  readonly label: string;
  readonly direction: "higher" | "lower";
  readonly format: MetricFormat;
}

/** What a metric can read besides the rows. Calibration and grounding are present only for the whole experiment. */
export interface MetricContext {
  readonly experiment: string;
  readonly scope: "overall" | "slice" | "epoch";
  readonly calibration?: CalibrationSummary;
  readonly grounding?: GroundingSummary;
}

export interface MetricDefinition extends MetricInfo {
  /** Per-case value. Enables paired significance tests in run comparison. */
  perCase?(row: CaseResult): number | null;
  aggregate(rows: readonly CaseResult[], context: MetricContext): number | null;
}
