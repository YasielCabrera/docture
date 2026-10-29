import { expect, it } from "vitest";
import { IncomparableRunsError, omittedOf, buildResult, looseEval, type CaseResult, type EvalResult } from "../src/index.js";
import { compareRuns } from "../src/comparison/index.js";
import { runInfo } from "./support/run.js";

const spec = looseEval();
function result(values: readonly number[], binary = false, groups = false): EvalResult {
  const cases: CaseResult[] = values.map((v, i) => ({ caseId: String(i), epoch: 0, experiment: "x", tags: {}, slices: { half: i < values.length / 2 ? "first" : "second" }, ...(groups ? { group: String(Math.floor(i / 4)) } : {}), startedAt: "2026-01-01", ms: v, outcome: "scored", expected: 1, actual: binary && v === 0 ? 0 : 1, score: spec.score(1, binary && v === 0 ? 0 : 1) }));
  const built = buildResult({ run: runInfo(["x"], 1, spec), cases });
  return { ...built, metrics: built.metrics.filter((m) => m.id === (binary ? "exactRate" : "latencyP50")) };
}
function compared(a: EvalResult, b: EvalResult, options: Parameters<typeof compareRuns>[2] = {}) { return compareRuns(a, b, options).experiments.x!; }
function metric(a: EvalResult, b: EvalResult, options: Parameters<typeof compareRuns>[2] = {}) { return compared(a, b, options).metrics[0]!; }
it("uses the exact two-sided binomial probability of discordant pairs", () => {
  const a = result(Array(12).fill(1), true);
  const b = result([...Array(8).fill(0), ...Array(4).fill(1)], true);
  expect(metric(a, b)).toMatchObject({ p: 0.0078125, test: "mcnemar", verdict: "regressed", n: 12 });
});
it("returns literal bootstrap bounds and repeats seeded results", () => {
  const a = result([1, 2, 3, 4, 5, 6]);
  const b = result([1.1, 2.4, 3.2, 4.8, 5.5, 6.9]);
  const options = { test: "bootstrap", seed: "known", resamples: 100 } as const;
  const first = metric(a, b, options);
  expect(first.ci).toEqual([0.27458333333333346, 0.6841666666666663]);
  expect(metric(a, b, options)).toEqual(first);
  expect(metric(a, b, { ...options, seed: "other" }).ci).not.toEqual(first.ci);
});
it("controls false positives for independent runs drawn from the same distribution", () => {
  let state = 777, flagged = 0;
  const random = () => (state = state * 16807 % 2147483647) / 2147483647;
  for (let seed = 0; seed < 100; seed++) {
    const a = result(Array.from({ length: 40 }, random));
    const b = result(Array.from({ length: 40 }, random));
    const m = metric(a, b, { seed: String(seed), resamples: 500 });
    expect(m.summaryDelta).not.toBe(0);
    if (m.verdict === "improved" || m.verdict === "regressed") flagged++;
  }
  expect(flagged / 100).toBeLessThanOrEqual(0.08);
});
it("detects a planted regression in one slice and leaves the other unchanged", () => {
  const a = result(Array(40).fill(1), true), b = result([...Array(20).fill(0), ...Array(20).fill(1)], true);
  const comparison = compared(a, b);
  expect(comparison.slices.half?.first?.[0]?.verdict).toBe("regressed");
  expect(comparison.slices.half?.second?.[0]?.verdict).toBe("unchanged");
  expect(comparison.paths[0]?.f1.verdict).toBe("regressed");
});
it("resamples correlated renditions as groups for a wider interval", () => {
  const a = result(Array(40).fill(10), false, true);
  const b = result(Array.from({ length: 40 }, (_, i) => 10 + Math.floor(i / 4) / 10), false, true);
  const group = metric(a, b, { test: "bootstrap", seed: "cluster", resamples: 1000 });
  const individual = metric(a, b, { test: "bootstrap", cluster: "case", seed: "cluster", resamples: 1000 });
  expect(group.ci![1] - group.ci![0]).toBeGreaterThan(individual.ci![1] - individual.ci![0]);
});
it("warns about fingerprints and pairs by case and epoch", () => {
  const a = result([1, 2, 3, 4, 5, 6]);
  const b = { ...a, run: { ...a.run, dataset: { ...a.run.dataset, fingerprint: "different" } }, cases: [...a.cases].reverse() };
  expect(compareRuns(a, b)).toMatchObject({ compatible: { dataset: false, warnings: ["Dataset fingerprints differ"] }, experiments: { x: { baseline: "x", candidate: "x", pairs: { paired: 6, baselineOnly: 0, candidateOnly: 0 } } } });
});
it("compares every experiment both runs have", () => {
  const a = result([1, 2, 3, 4, 5, 6]);
  const both = { ...a, cases: [...a.cases, ...a.cases.map((row) => ({ ...row, experiment: "other" }))], summary: { ...a.summary, other: a.summary.x! } };
  expect(Object.keys(compareRuns(both, both).experiments)).toEqual(["other", "x"]);
  expect(Object.keys(compareRuns(both, both, { experiment: ["other", "x"] }).experiments)).toEqual(["x"]);
});
it("rejects runs that cannot be paired with one error listing every problem", () => {
  const a = result([1, 2, 3, 4, 5, 6]);
  const renamed = { ...a, cases: a.cases.map((row) => ({ ...row, experiment: "y" })), summary: { y: a.summary.x! } };
  expect(() => compareRuns(a, renamed)).toThrow(IncomparableRunsError);
  expect(() => compareRuns(a, renamed)).toThrow("The runs cannot be compared:\n  - the runs share no experiment (baseline: x; candidate: y); select a pair explicitly");
  const duplicated = { ...a, cases: [...a.cases, a.cases[0]!] };
  expect(() => compareRuns(a, duplicated, { experiment: ["x", "missing"] })).toThrow(
    "The runs cannot be compared:\n  - the candidate run has no experiment missing",
  );
  expect(() => compareRuns(duplicated, duplicated)).toThrow(
    "The runs cannot be compared:\n  - the baseline experiment x has case 0 epoch 0 more than once\n  - the candidate experiment x has case 0 epoch 0 more than once",
  );
  const shifted = { ...a, cases: a.cases.map((row) => ({ ...row, epoch: 1 })) };
  expect(() => compareRuns(a, shifted)).toThrow("The runs cannot be compared:\n  - experiments x and x have no case and epoch in common");
});
it("tests serialized custom metric values without executable definitions", () => {
  const a = result([1, 2, 3, 4, 5, 6]);
  const custom = { id: "quality", label: "Quality", direction: "higher", format: "number" } as const;
  const modify = (r: EvalResult, v: number): EvalResult => ({ ...r, metrics: [custom], cases: r.cases.map((row) => ({ ...row, values: { quality: v } })), summary: { x: { ...r.summary.x!, overall: { quality: v } } } });
  expect(metric(modify(a, 0.9), modify(a, 0.7), { resamples: 100 })).toMatchObject({ test: "bootstrap", verdict: "regressed", n: 6 });
  const small = result([1, 1, 1, 1], true);
  expect(metric(small, result([0, 0, 0, 0], true))).toMatchObject({ summaryDelta: -1, pairedDelta: -1, test: "none", verdict: "insufficient", n: 4 });
});
it("respects lower-is-better direction and reports errored and fixed cases", () => {
  const a = result([1, 2, 3, 4, 5, 6]), b = result([11, 12, 13, 14, 15, 16]);
  expect(metric(a, b, { resamples: 100 })).toMatchObject({ summaryDelta: 10, pairedDelta: 10, verdict: "regressed" });
  const failed: CaseResult = { ...a.cases[0]!, outcome: "errored", expected: 1, error: { name: "Error", message: "failed" }, omitted: { fields: 1, weight: 1, segments: {}, paths: {} } };
  const errored = { ...a, cases: [failed, ...a.cases.slice(1)] };
  expect(compared(a, errored).cases.newlyErrored).toEqual([{ caseId: "0", epoch: 0, baseline: "scored", candidate: "errored" }]);
  expect(compared(errored, a).cases.fixed).toEqual([{ caseId: "0", epoch: 0, baseline: "errored", candidate: "scored" }]);
});
it("leaves metrics with no stored values or per-case function untested", () => {
  const a = result([1, 2, 3, 4, 5, 6]);
  const quality = { id: "quality", label: "Quality", direction: "higher", format: "number" } as const;
  const r = { ...a, metrics: [quality], summary: { x: { ...a.summary.x!, overall: { quality: 1 } } } };
  expect(metric(r, r)).toMatchObject({ test: "none", p: null, verdict: "not-tested", n: 0 });
});

it("computes McNemar with both gains and losses and falls back for continuous metrics", () => {
  expect(metric(result([0, 0, ...Array(8).fill(1)], true), result([1, 1, ...Array(8).fill(0)], true), { test: "mcnemar" }).p).toBe(0.109375);
  expect(metric(result([1, 2, 3, 4, 5, 6]), result([2, 3, 4, 5, 6, 7]), { test: "mcnemar" }).test).toBe("bootstrap");
});
it("treats correlated binary renditions and repeated epochs as five independent clusters", () => {
  const a = result(Array(20).fill(1), true, true), b = result(Array(20).fill(0), true, true);
  expect(metric(a, b)).toMatchObject({ test: "bootstrap", p: 0.0625, verdict: "inconclusive", n: 20 });
  const epochs = (r: EvalResult): EvalResult => ({ ...r, cases: r.cases.map((row, i) => ({ ...row, caseId: String(i % 5), epoch: Math.floor(i / 5) })) });
  expect(metric(epochs(a), epochs(b), { cluster: "case" })).toMatchObject({ test: "bootstrap", p: 0.0625, verdict: "inconclusive", n: 20 });
});
it("controls small-cluster false positives under seeded symmetric sampling", () => {
  let state = 761, flagged = 0;
  const random = () => (state = state * 16807 % 2147483647) / 2147483647;
  for (let run = 0; run < 200; run++) {
    const a = result(Array(6).fill(10));
    const b = result(Array.from({ length: 6 }, () => 10 + 2 * random() - 1));
    const m = metric(a, b, { test: "bootstrap", seed: String(run), resamples: 200 });
    expect(m.p).toBeGreaterThan(0);
    if (m.verdict === "improved" || m.verdict === "regressed") flagged++;
  }
  expect(flagged / 200).toBeLessThanOrEqual(0.08);
});
it("keeps the verdict aligned with paired means when micro summary moves the other way", () => {
  const big = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(i), 1]));
  const wrong = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(i), 0]));
  const make = (candidate: boolean): EvalResult => {
    const cases: CaseResult[] = Array.from({ length: 21 }, (_, i) => {
      const expected = i === 20 ? big : { a: 1 };
      const actual = i === 20 ? candidate ? big : wrong : { a: candidate ? 0 : 1 };
      return { caseId: String(i), epoch: 0, experiment: "x", tags: {}, startedAt: "2026-01-01", ms: 1, outcome: "scored", expected, actual, score: spec.score(expected, actual) };
    });
    return buildResult({ run: runInfo(["x"], 1, spec), cases });
  };
  const a = make(false), b = make(true);
  const f1 = compared(a, b).metrics.find((m) => m.metric === "f1")!;
  expect(f1.summaryDelta).toBeGreaterThan(0);
  expect(f1.pairedDelta).toBeLessThan(0);
  expect(f1.verdict).toBe("regressed");
  expect(compared(b, a).metrics.find((m) => m.metric === "f1")?.verdict).toBe("improved");
});
it("counts errored segment omissions in paired tests", () => {
  const a = result(Array(12).fill(1), true);
  const cases: CaseResult[] = a.cases.map((row) => {
    if (row.outcome !== "scored") throw new Error("expected scored row");
    return { ...row, outcome: "errored", error: { name: "Error", message: "failed" }, omitted: omittedOf(spec.score(row.expected, undefined)) };
  });
  const b = buildResult({ run: a.run, cases });
  const base = buildResult({ run: a.run, cases: a.cases });
  const segments = Object.values(compared(base, b).segments).flat().filter((m) => m.metric === "f1");
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0]).toMatchObject({ n: 12, pairedDelta: -1, verdict: "regressed" });
  const micro = Object.values(compared(base, b).segments).flat().find((m) => m.metric === "f1.micro");
  expect(micro).toMatchObject({ n: 0, pairedDelta: null });
});
it("counts errored path omissions in paired path tests", () => {
  const scoredRows: CaseResult[] = Array.from({ length: 12 }, (_, i) => ({ caseId: String(i), epoch: 0, experiment: "x", tags: {}, startedAt: "2026-01-01", ms: 1, outcome: "scored", expected: { a: 1, b: 2 }, actual: { a: 1, b: 2 }, score: spec.score({ a: 1, b: 2 }, { a: 1, b: 2 }) }));
  const erroredRows = scoredRows.map((row): CaseResult => ({ ...row, outcome: "errored", expected: { a: 1, b: 2 }, error: { name: "Error", message: "failed" }, omitted: omittedOf(spec.score({ a: 1, b: 2 }, undefined)) }));
  const base = buildResult({ run: runInfo(["x"], 1, spec), cases: scoredRows });
  const candidate = buildResult({ run: runInfo(["x"], 1, spec), cases: [...erroredRows.slice(0, 6), ...scoredRows.slice(6)] });
  const path = compared(base, candidate).paths.find((entry) => entry.pattern === "a");
  expect(path?.counts).toEqual({ baseline: { match: 12, mismatch: 0, omission: 0, hallucination: 0 }, candidate: { match: 6, mismatch: 0, omission: 6, hallucination: 0 } });
  expect(path?.f1).toMatchObject({ baseline: 1, candidate: 2 / 3, summaryDelta: 2 / 3 - 1, pairedDelta: -0.5, n: 12 });
});
it("detects a slice regression through the clustered bootstrap path", () => {
  const a = result(Array(40).fill(1)), b = result([...Array(20).fill(2), ...Array(20).fill(1)]);
  const slices = compared(a, b, { test: "bootstrap", resamples: 500 }).slices;
  expect(slices.half?.first?.[0]).toMatchObject({ test: "bootstrap", verdict: "regressed" });
  expect(slices.half?.second?.[0]?.verdict).toBe("unchanged");
});
it("uses stored slices and excludes config mismatches with unpaired warnings", () => {
  const a = result(Array(12).fill(1));
  const b = result(Array(12).fill(2));
  const tagged = (r: EvalResult, configHash: string): EvalResult => ({ ...r, cases: r.cases.map((row, i) => ({ ...row, tags: { half: "wrong" }, configHash: i === 0 ? configHash : "same" })) });
  const comparison = compareRuns(tagged(a, "a"), tagged(b, "b"), { test: "bootstrap" });
  expect(comparison.experiments.x?.pairs).toEqual({ paired: 11, baselineOnly: 1, candidateOnly: 1 });
  expect(comparison.compatible.warnings).toEqual(["Experiment x has unpaired rows: baselineOnly=1, candidateOnly=1", "Experiment x has rows with differing configHash; excluded from pairing"]);
  expect(comparison.experiments.x?.slices.half?.first?.[0]?.n).toBe(5);
});
it("produces the same seeded output regardless of row order with non-ASCII ids", () => {
  const rename = (r: EvalResult): EvalResult => ({ ...r, cases: r.cases.map((row, i) => ({ ...row, caseId: ["ä", "z", "A", "é", "Z", "a"][i]! })) });
  const a = rename(result([1, 2, 3, 4, 5, 6])), b = rename(result([2, 2, 3.2, 4.7, 5.1, 7]));
  expect(compareRuns(a, b, { seed: "ordering" })).toEqual(compareRuns({ ...a, cases: [...a.cases].reverse() }, { ...b, cases: [...b.cases].reverse() }, { seed: "ordering" }));
});
it("keeps bootstrap p-values positive when every resample has the same sign", () => {
  expect(metric(result(Array(30).fill(1)), result(Array(30).fill(2)), { test: "bootstrap", resamples: 100 }).p).toBe(2 / 101);
});
it("applies Holm adjustment across a slice family", () => {
  const a = result(Array(16).fill(1), true), b = result(Array(16).fill(0), true);
  const comparison = compared(a, b);
  expect(comparison.slices.half?.first?.[0]?.p).toBe(0.015625);
  expect(comparison.slices.half?.second?.[0]?.p).toBe(0.015625);
});
it("identifies outcome changes by both case and epoch", () => {
  const a = result(Array(6).fill(1));
  const base = { ...a, cases: [...a.cases, ...a.cases.map((row) => ({ ...row, epoch: 1 }))] };
  const candidate = { ...base, cases: base.cases.map((row): CaseResult => row.caseId === "0" ? { ...row, outcome: "errored", expected: 1, omitted: { fields: 1, weight: 1, segments: {}, paths: {} }, error: { name: "Error", message: "failed" } } : row) };
  expect(compared(base, candidate).cases.newlyErrored.map(({ caseId, epoch }) => ({ caseId, epoch }))).toEqual([{ caseId: "0", epoch: 0 }, { caseId: "0", epoch: 1 }]);
});
