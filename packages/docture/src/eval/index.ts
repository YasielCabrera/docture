/**
 * docture/eval — grade an extraction run.
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
export { gate } from "./gate.js";
export type { GateOptions, GateResult } from "./gate.js";
