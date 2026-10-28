/**
 * docture/eval — grade an extraction run or a conversion.
 *
 * ```ts
 * const result = await extractor.extract(pdf.bytes, Invoice);
 * const score = scoreExtraction(pdf.expected, result.data);
 * expect(score.f1, formatFailures(score)).toBe(1);
 * ```
 */

export { failures, hallucinations, scoreExtraction } from "./scorer.js";
export type { FieldResult, FieldStatus, Score, ScoreOptions } from "./scorer.js";

export { aggregate, formatFailures, formatScoreboard, recordRun } from "./report.js";
export type { Aggregate, FieldAggregate, RunRecord } from "./report.js";
export { calibrateFields, formatCalibration } from "./calibration.js";
export type { CalibrationSample, CalibrationOptions, CalibrationPair, ThresholdCandidate, FieldThresholdReport, CalibrationReport } from "./calibration.js";
export { gate } from "./gate.js";
export type { GateOptions, GateResult } from "./gate.js";
export { checkConversion } from "./conversion.js";
export type {
  AbsentCheck,
  ConversionCheck,
  ConversionCheckKind,
  ConversionCheckResult,
  ConversionReport,
  ConvertedPages,
  OrderCheck,
  PresentCheck,
  TableCheck,
} from "./conversion.js";
