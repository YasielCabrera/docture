import { expect, it } from "vitest";
import { calibrateFields, type CalibrationSample } from "../../src/eval/calibration.js";

function sample(document: string, actual: number, confidence?: number): CalibrationSample {
  return { document, expected: { amount: 10 }, result: { data: { amount: actual }, citations: [{ path: "amount", status: "verified" as const, ids: ["p1-line-1" as const], ...(confidence === undefined ? {} : { minOcrConfidence: confidence }) }] } };
}

it("evaluates whole confidence ties and searches non-monotonic empirical precision", () => {
  const report = calibrateFields([sample("a", 10, .9), sample("b", 99, .9), sample("c", 10, .8), sample("d", 10, .7), sample("unknown", 10)], { targetPrecision: .75, minSupport: 2 });
  expect(report.experimental).toBe(true);
  expect(report.fields[0]).toMatchObject({ path: "amount", status: "supported", threshold: .7, precision: .75, accepted: 4, rejected: 0, unknown: 1, support: 4 });
  expect(report.fields[0]?.candidates.map((candidate) => [candidate.threshold, candidate.accepted, candidate.precision])).toEqual([[.9, 2, .5], [.8, 3, 2 / 3], [.7, 4, .75]]);
});

it("reports insufficient support and empty input without inventing thresholds", () => {
  expect(calibrateFields([], { targetPrecision: .9 }).fields).toEqual([]);
  expect(calibrateFields([sample("a", 10, .9)], { targetPrecision: .9, minSupport: 2 }).fields[0]).toMatchObject({ status: "no-supported-threshold", threshold: null, accepted: 0, rejected: 1, unknown: 0 });
});

it("keeps array positions and literal dotted keys separate and rejects reordered alignment", () => {
  const report = calibrateFields([{ document: "paths", expected: { "a.b": 1, a: { b: 2 }, items: [{ amount: 3 }] }, result: { data: { "a.b": 9, a: { b: 2 }, items: [{ amount: 3 }] }, citations: [
    { path: "`a.b`", status: "verified", ids: ["p1-line-1"], minOcrConfidence: .8 },
    { path: "a.b", status: "verified", ids: ["p1-line-1"], minOcrConfidence: .9 },
    { path: "items.0.amount", status: "verified", ids: ["p1-line-1"], minOcrConfidence: .7 },
  ] } }], { targetPrecision: 1, minSupport: 1 });
  expect(report.pairs.map((pair) => [pair.path, pair.status, pair.confidence])).toEqual([["`a.b`", "mismatch", .8], ["a.b", "match", .9], ["items.0.amount", "match", .7]]);
  expect(() => calibrateFields([], { targetPrecision: .9, scoreOptions: { alignArraysBy: "id" } })).toThrow("alignArraysBy");
});

it("counts omissions, hallucinations and absent evidence explicitly", () => {
  const report = calibrateFields([{ document: "missing", expected: { missing: 1 }, result: { data: { invented: 2 }, citations: [{ path: "invented", status: "uncited", ids: [] }] } }], { targetPrecision: 1 });
  expect(report.pairs.map((pair) => [pair.path, pair.status, pair.evidence, pair.confidence])).toEqual([["missing", "omission", "uncited", null], ["invented", "hallucination", "uncited", null]]);
});

it("retains path-dependent date comparison from the ordinary scorer", () => {
  const report = calibrateFields([{ document: "dated", expected: { issuedAt: "January 2, 2026" }, result: { data: { issuedAt: "2026-01-02" }, citations: [{ path: "issuedAt", status: "verified", ids: ["p1-line-1"], minOcrConfidence: .8 }] } }], { targetPrecision: 1, minSupport: 1 });
  expect(report.pairs[0]?.status).toBe("match");
  expect(report.fields[0]).toMatchObject({ status: "supported", threshold: .8 });
});

it("uses ordinary date comparison for array leaves without changing evidence paths", () => {
  const report = calibrateFields([{ document: "dates", expected: { dates: ["January 2, 2026"], "invoice.date": "January 3, 2026" }, result: { data: { dates: ["2026-01-02"], "invoice.date": "2026-01-03" }, citations: [
    { path: "dates.0", status: "verified", ids: ["p1-line-1"], minOcrConfidence: .9 },
    { path: "`invoice.date`", status: "verified", ids: ["p1-line-2"], minOcrConfidence: .8 },
  ] } }], { targetPrecision: 1, minSupport: 1 });
  expect(report.pairs.map((pair) => [pair.path, pair.status])).toEqual([["dates.0", "match"], ["`invoice.date`", "match"]]);
  expect(report.fields.map((field) => [field.status, field.threshold])).toEqual([["supported", .9], ["supported", .8]]);
});
