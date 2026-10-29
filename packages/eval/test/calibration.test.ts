import { expect, it } from "vitest";
import { buildResult, looseEval, omittedOf, type CaseResult, type EvalResult } from "../src/index.js";
import { calibrate, mergeCalibration, calibrationSection } from "../src/calibration/index.js";
import { runInfo } from "./support/run.js";
const spec = looseEval();
function result(values: readonly (readonly [number | undefined, boolean])[]): EvalResult {
  const cases: CaseResult[] = values.map(([confidence, correct], i) => ({ caseId: String(i), epoch: 0, experiment: "x", tags: {}, startedAt: "2026-01-01", ms: 1, outcome: "scored", expected: { a: 1 }, actual: { a: correct ? 1 : 0 }, score: spec.score({ a: 1 }, { a: correct ? 1 : 0 }, confidence === undefined ? {} : { confidence: { a: confidence } }) }));
  return buildResult({ run: runInfo(["x"], 1, spec), cases });
}
it("computes known ECE, Brier, tied AUROC and ranked average precision", () => {
  const report = calibrate(result([[0.9, true], [0.8, false], [0.8, true], [0.1, false]]), { bins: 2, minSupport: 1 });
  const stats = report.experiments.x!.overall;
  expect(stats.ece).toBeCloseTo(0.15, 14);
  expect(stats.brier).toBeCloseTo(0.175, 14);
  expect(stats.auroc).toBe(0.875);
  expect(stats.averagePrecision).toBeCloseTo(5 / 12, 14);
  expect(stats.threshold).toBeNull();
  expect(stats.coverageAtPrecision).toBe(0);
});
it("merges exact score counts in any order as if the runs were concatenated", () => {
  const values = [[0.9, true], [0.2, false], [0.8, true], [0.8, false], [undefined, true]] as const;
  const a = calibrate(result(values.slice(0, 2))), b = calibrate(result(values.slice(2, 4))), c = calibrate(result(values.slice(4)));
  const whole = calibrate(result(values));
  expect(mergeCalibration(mergeCalibration(a, b), c)).toEqual(whole);
  expect(mergeCalibration(c, mergeCalibration(b, a))).toEqual(whole);
  expect(calibrate({ ...result(values), cases: [...result(values).cases].reverse() })).toEqual(whole);
});
it("selects the widest supported threshold and reports missing confidence", () => {
  const report = calibrate(result([[0.99, true], [0.95, true], [0.9, true], [0.8, false], [undefined, true]]), { minSupport: 3 });
  expect(report.experiments.x).toMatchObject({ graded: 5, overall: { support: 4, threshold: null, coverageAtPrecision: 0 } });
  expect(calibrationSection({ minSupport: 3 })(result([[0.99, true]]))).toHaveProperty("calibration");
});
it("excludes omissions while counting hallucinations as incorrect predictions", () => {
  const r = result([[0.9, true]]);
  const first = r.cases[0]!;
  if (first.outcome !== "scored") throw new Error("expected scored row");
  const score = spec.score({ a: 1 }, { extra: 1 }, { confidence: { extra: 0.8 } });
  const report = calibrate({ ...r, cases: [{ ...first, score }] });
  expect(report.experiments.x).toMatchObject({ omissions: 1, graded: 1, overall: { support: 1, brier: 0.6400000000000001, auroc: null } });
});
it("rejects incompatible merge settings and invalid probabilities", () => {
  expect(() => calibrate(result([[1.1, true]]))).toThrow();
  expect(() => mergeCalibration(calibrate(result([])), calibrate(result([]), { bins: 2 }))).toThrow("settings must match");
});

it("requires a one-sided 95 percent precision bound before auto-accepting", () => {
  expect(calibrate(result(Array.from({ length: 5 }, () => [0.9, true] as const))).experiments.x?.overall.threshold).toBeNull();
  expect(calibrate(result(Array.from({ length: 298 }, () => [0.9, true] as const))).experiments.x?.overall.threshold).toBeNull();
  expect(calibrate(result(Array.from({ length: 299 }, () => [0.9, true] as const))).experiments.x?.overall.threshold).toBe(0.9);
});
it("uses exact bin boundaries and exposes coverage accuracy and maximum error", () => {
  const stats = calibrate(result([[0.29, true], [0.1, false]]), { bins: 100, minSupport: 1 }).experiments.x!.overall;
  expect(stats.bins[29]?.count).toBe(1);
  expect(stats.bins[28]?.count).toBe(0);
  expect(stats.mce).toBeCloseTo(0.71);
  expect(stats.accuracyAtCoverage).toMatchObject({ "0.5": 1, "1": 0.5 });
  expect(stats.coverageAtAccuracy).toMatchObject({ "0.5": 1, "1": 0.5 });
});
it("divides ranked precision by expected fields including omissions", () => {
  const r = result([[0.9, true]]), first = r.cases[0]!;
  if (first.outcome !== "scored") throw new Error("expected scored row");
  const expected = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), 1]));
  const score = spec.score(expected, { "0": 1 }, { confidence: { "0": 0.9 } });
  expect(calibrate({ ...r, cases: [{ ...first, score }] }).experiments.x).toMatchObject({ omissions: 9, overall: { groundTruth: 10, averagePrecision: 0.1 } });
});
it("rejects merging reports missing omission counts", () => {
  const report = calibrate(result([[0.9, true]]));
  const corrupted = JSON.parse(JSON.stringify(report));
  delete corrupted.experiments.x.omissions;
  expect(() => mergeCalibration(report, corrupted)).toThrow("omissions must be present");
});
it("counts an errored case's omissions in every group's ranked-precision denominator", () => {
  const scoredRow = result([[0.9, true]]).cases[0]!;
  const failed: CaseResult = { ...scoredRow, caseId: "failed", outcome: "errored", expected: { a: 1, b: 2 }, error: { name: "Error", message: "failed" }, omitted: omittedOf(spec.score({ a: 1, b: 2 }, undefined)) };
  const r = buildResult({ run: runInfo(["x"], 1, spec), cases: [scoredRow, failed] });
  const byPattern = calibrate(r, { minSupport: 1 }).experiments.x!;
  expect(byPattern).toMatchObject({ omissions: 2, overall: { groundTruth: 3, averagePrecision: 1 / 3 } });
  expect(Object.fromEntries(Object.entries(byPattern.groups).map(([key, stats]) => [key, [stats.groundTruth, stats.averagePrecision]]))).toEqual({ a: [2, 0.5], b: [1, 0] });
  const bySegment = calibrate(r, { minSupport: 1, by: "segment" }).experiments.x!;
  expect(Object.values(bySegment.groups).map((stats) => stats.groundTruth)).toEqual([3]);
  const byType = calibrate(r, { minSupport: 1, by: "fieldType" }).experiments.x!;
  expect(Object.values(byType.groups).reduce((sum, stats) => sum + stats.groundTruth, 0)).toBe(3);
});
