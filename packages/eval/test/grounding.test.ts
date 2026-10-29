import { expect, it } from "vitest";
import { buildResult, intersectionOverUnion, looseEval, type CaseResult, type EvalResult, type ScoreExtras } from "../src/index.js";
import { grounding, groundingSection } from "../src/grounding/index.js";
import { runInfo } from "./support/run.js";
const spec = looseEval();
const box = { x: 0, y: 0, width: 10, height: 10 };
function result(extras: ScoreExtras = {}, actual: unknown = { a: 1 }): EvalResult {
  const row: CaseResult = { caseId: "a", epoch: 0, experiment: "x", tags: {}, startedAt: "2026-01-01", ms: 1, ...(extras.locations === undefined ? {} : { locations: extras.locations }), outcome: "scored", expected: { a: 1 }, actual: null, score: spec.score({ a: 1 }, actual, extras) };
  return buildResult({ run: runInfo(["x"], 1, spec), cases: [row] });
}
it("uses known IoU values and requires a correct value on the expected page", () => {
  expect(intersectionOverUnion(box, { ...box, x: 5 })).toBe(1 / 3);
  expect(intersectionOverUnion(box, box)).toBe(1);
  const r = result({ locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1, box: { ...box, x: 5 } }] });
  expect(grounding(r).experiments.x).toMatchObject({ overall: { grounded: 0, groundedRecall: 0 } });
  expect(grounding(r, { iou: 0.3 }).experiments.x).toMatchObject({ overall: { grounded: 1, groundedPrecision: 1, groundedRecall: 1, groundedF1: 1 } });
  expect(grounding(r, { level: "page" }).experiments.x?.overall.groundedF1).toBe(1);
});
it("does not ground wrong values or evidence on a different page", () => {
  const extras = { locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1, box }] };
  expect(grounding(result(extras, { a: 2 })).experiments.x?.overall.grounded).toBe(0);
  expect(grounding(result({ ...extras, evidence: [{ path: "a", pageNumber: 2, box }] }), { level: "page" }).experiments.x?.overall.grounded).toBe(0);
});
it("excludes unlabelled cases and retains segment metrics", () => {
  const labelled = result({ locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1, box }] });
  const r = { ...labelled, cases: [...labelled.cases, ...result().cases] };
  const summary = grounding(r).experiments.x!;
  expect(summary.cases).toEqual({ labelled: 1, unlabelled: 1 });
  expect(summary.overall.labelled).toBe(1);
  expect(Object.values(summary.segments)[0]?.groundedF1).toBe(1);
  expect(groundingSection()(r)).toHaveProperty("grounding");
});
it("counts case-level labels without any emitted fields and accepts external locations", () => {
  const r = result({}, undefined);
  const report = grounding(r, { locations: { a: { a: [{ pageNumber: 1, box }] } } });
  expect(report.experiments.x).toMatchObject({ cases: { labelled: 1, unlabelled: 0 }, overall: { labelled: 1, grounded: 0, groundedRecall: 0 } });
  expect(grounding({ ...r, cases: r.cases.map((row) => ({ ...row, locations: { a: [{ pageNumber: 1, box }] }, ...(row.outcome === "scored" ? { score: { ...row.score, fields: [] } } : {}) })) }).experiments.x?.overall.labelled).toBe(1);
});
it("counts predictions without evidence against grounded precision", () => {
  const r = result({ locations: { a: [{ pageNumber: 1, box }] } });
  expect(grounding(r).experiments.x).toMatchObject({ overall: { predicted: 1, withEvidence: 0, groundedPrecision: 0, groundedRecall: 0, groundedF1: 0 } });
});
it("retains labels as omissions when extraction fails", () => {
  const r = result();
  const first = r.cases[0]!;
  const failed: CaseResult = { ...first, outcome: "errored", expected: { a: 1 }, locations: { a: [{ pageNumber: 1, box }] }, error: { name: "Error", message: "failed" }, omitted: { fields: 1, weight: 1, segments: {}, paths: {} } };
  expect(grounding({ ...r, cases: [failed] }).experiments.x).toMatchObject({ cases: { labelled: 1, unlabelled: 0 }, overall: { labelled: 1, predicted: 0, groundedRecall: 0, groundedF1: 0 } });
});

it("agrees with scorer grounding for page-only labels and box-less evidence", () => {
  for (const extras of [
    { locations: { a: [{ pageNumber: 1 }] }, evidence: [{ path: "a", pageNumber: 1 }] },
    { locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1 }] },
  ]) {
    const r = result(extras), row = r.cases[0]!;
    if (row.outcome !== "scored") throw new Error("expected scored row");
    expect(grounding(r).experiments.x?.overall.grounded).toBe(Number(row.score.fields[0]!.grounded));
  }
});
it("excludes skipped cases from labelled and unlabelled totals", () => {
  const r = result({ locations: { a: [{ pageNumber: 1, box }] } });
  const skipped: CaseResult = { ...r.cases[0]!, outcome: "skipped", reason: "out of scope" };
  expect(grounding({ ...r, cases: [skipped] }).experiments.x?.cases).toEqual({ labelled: 0, unlabelled: 0 });
});
it("counts hallucinations against grounded precision", () => {
  const r = result({ locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1, box }, { path: "extra", pageNumber: 1, box }] }, { a: 1, extra: 2 });
  expect(grounding(r).experiments.x?.overall).toMatchObject({ predicted: 2, grounded: 1, groundedPrecision: 0.5, groundedRecall: 1 });
});
it("rejects IoU outside the supported interval", () => {
  for (const iou of [0, -0.1, 1.1, NaN]) expect(() => grounding(result(), { iou })).toThrow("IoU must be in (0, 1]");
});
