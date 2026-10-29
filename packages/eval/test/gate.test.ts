import { describe, expect, it } from "vitest";
import { EvalSpecError, gate, type ExperimentComparison, type MetricDelta, type RunComparison } from "../src/index.js";
import { sampleResult } from "./support/sample-result.js";

const result = sampleResult();

function summary(outcome: ReturnType<typeof gate>) {
  return { pass: outcome.pass, checks: outcome.checks.map((check) => [check.status, check.message]) };
}

function compared(experiment: string, metrics: readonly MetricDelta[]): ExperimentComparison {
  return {
    baseline: experiment, candidate: experiment,
    pairs: { paired: 3, baselineOnly: 0, candidateOnly: 0 },
    metrics, segments: {}, slices: {}, paths: [],
    cases: { regressed: [], improved: [], newlyErrored: [], fixed: [] },
  };
}

function comparisonWith(experiments: Readonly<Record<string, readonly MetricDelta[]>>): RunComparison {
  return {
    baselineRunId: "run-0",
    candidateRunId: "run-1",
    settings: { test: "auto", resamples: 1000, seed: "eval", alpha: 0.05, cluster: "group" },
    compatible: { dataset: true, spec: true, warnings: [] },
    experiments: Object.fromEntries(Object.entries(experiments).map(([id, metrics]) => [id, compared(id, metrics)])),
  };
}

const f1Drop = (verdict: MetricDelta["verdict"]): MetricDelta => ({
  metric: "f1", baseline: 0.8, candidate: 0.77, summaryDelta: -0.03, pairedDelta: -0.025, ci: [-0.05, -0.01], p: verdict === "regressed" ? 0.01 : 0.4, test: "bootstrap", verdict, n: 3,
});

const f1Gain: MetricDelta = {
  metric: "f1", baseline: 0.9, candidate: 0.92, summaryDelta: 0.02, pairedDelta: 0.02, ci: [0.01, 0.03], p: 0.02, test: "bootstrap", verdict: "improved", n: 3,
};

describe("gate", () => {
  it("checks overall thresholds per experiment, with equality passing", () => {
    expect(summary(gate(result, { thresholds: [{ metric: "f1", min: 0.9 }, { metric: "f1", scope: "micro", experiment: "llm", min: 50 / 52 }] }))).toEqual({
      pass: false,
      checks: [
        ["fail", "f1 for experiment llm is 0.7692, below the minimum 0.9"],
        ["pass", "f1 for experiment parser is 0.9388"],
        ["pass", "f1.micro for experiment llm is 0.9615"],
      ],
    });
  });

  it("checks segment, slice and path thresholds", () => {
    expect(summary(gate(result, { thresholds: [
      { metric: "f1", scope: "micro", segment: "header", experiment: "llm", min: 0.95 },
      { metric: "errorRate", slice: { rendition: "scan" }, experiment: "llm", max: 0.25 },
      { metric: "f1", path: "issuer", experiment: "llm", min: 0.75 },
    ] }))).toEqual({
      pass: false,
      checks: [
        ["fail", "f1.micro in segment header for experiment llm is 0.9375, below the minimum 0.95"],
        ["fail", "errorRate for rendition=scan for experiment llm is 0.5, above the maximum 0.25"],
        ["fail", "f1 at issuer for experiment llm is 0.6, below the minimum 0.75"],
      ],
    });
  });

  it("fails on a missing value unless onNull is pass", () => {
    const options = { thresholds: [{ metric: "costUsd", experiment: "parser", max: 1 }, { metric: "f1", slice: { rendition: "photo" }, experiment: "llm", min: 0.5 }] };
    expect(summary(gate(result, options))).toEqual({
      pass: false,
      checks: [["fail", "costUsd for experiment parser has no value"], ["fail", "f1 for rendition=photo for experiment llm has no value"]],
    });
    expect(gate(result, { ...options, onNull: "pass" }).pass).toBe(true);
  });

  it("turns maxErrorRate and maxFallbackRate into thresholds", () => {
    expect(summary(gate(result, { maxErrorRate: 0.1, maxFallbackRate: 0.2 }))).toEqual({
      pass: false,
      checks: [
        ["fail", "errorRate for experiment llm is 0.3333, above the maximum 0.1"],
        ["pass", "errorRate for experiment parser is 0"],
        ["pass", "fallbackRate for experiment llm is 0.1667"],
        ["pass", "fallbackRate for experiment parser is 0"],
      ],
    });
  });

  it("applies regression budgets to the result's comparison", () => {
    const regressions = { maxDrop: { f1: 0.01 }, requireSignificance: true };
    expect(summary(gate({ ...result, comparison: comparisonWith({ llm: [f1Drop("regressed")] }) }, { regressions }))).toEqual({
      pass: false, checks: [["fail", "f1 for experiment llm dropped by 0.03, over the budget 0.01"]],
    });
    expect(summary(gate({ ...result, comparison: comparisonWith({ llm: [f1Drop("inconclusive")] }) }, { regressions }))).toEqual({
      pass: true, checks: [["pass", "f1 for experiment llm dropped by 0.03, over the budget 0.01, but the comparison found it inconclusive, not regressed"]],
    });
    expect(summary(gate({ ...result, comparison: comparisonWith({ llm: [f1Drop("inconclusive")] }) }, { regressions: { maxDrop: { f1: 0.01 } } })).pass).toBe(false);
    expect(summary(gate({ ...result, comparison: comparisonWith({ llm: [f1Drop("regressed")] }) }, { regressions: { requireSignificance: true } }))).toEqual({
      pass: false, checks: [["fail", "f1 for experiment llm regressed significantly (p 0.01)"]],
    });
  });

  it("checks regression budgets for every compared experiment", () => {
    const comparison = comparisonWith({ llm: [f1Drop("regressed")], parser: [f1Gain] });
    expect(summary(gate({ ...result, comparison }, { regressions: { maxDrop: { f1: 0.01 } } }))).toEqual({
      pass: false,
      checks: [
        ["fail", "f1 for experiment llm dropped by 0.03, over the budget 0.01"],
        ["pass", "f1 for experiment parser changed by 0.02, within the drop budget 0.01"],
      ],
    });
    expect(summary(gate({ ...result, comparison }, { regressions: { requireSignificance: true } }))).toEqual({
      pass: false,
      checks: [
        ["fail", "f1 for experiment llm regressed significantly (p 0.01)"],
        ["pass", "no metric regressed significantly for experiment parser"],
      ],
    });
  });

  it("fails a run that did not complete before checking any threshold", () => {
    const aborted = { ...result, run: { ...result.run, status: "aborted" as const } };
    expect(gate(aborted, { maxErrorRate: 1 })).toEqual({
      pass: false,
      checks: [
        { kind: "run", experiment: "", metric: "", target: "run status", value: null, status: "fail", message: "the run is aborted with 9 of 12 jobs recorded; a gate needs a complete run" },
        { kind: "threshold", experiment: "llm", metric: "errorRate", target: "errorRate", value: 1 / 3, max: 1, status: "pass", message: "errorRate for experiment llm is 0.3333" },
        { kind: "threshold", experiment: "parser", metric: "errorRate", target: "errorRate", value: 0, max: 1, status: "pass", message: "errorRate for experiment parser is 0" },
      ],
    });
    expect(gate({ ...result, run: { ...result.run, status: "in-progress" } }, {}).checks.map((check) => check.message)).toEqual([
      "the run is in-progress with 9 of 12 jobs recorded; a gate needs a complete run",
    ]);
    expect(gate(result, {})).toEqual({ pass: true, checks: [] });
  });

  it("skips regression budgets when the result has no comparison", () => {
    expect(summary(gate(result, { regressions: { maxDrop: { f1: 0.01 } } }))).toEqual({
      pass: true, checks: [["skipped", "no baseline comparison in this result; regression budgets were not checked"]],
    });
  });

  it("rejects invalid options in one error listing every problem", () => {
    const build = () => gate(result, {
      thresholds: [{ metric: "f2", min: 0.5 }, { metric: "errorRate", scope: "macro", max: 0.1 }, { metric: "f1" }, { metric: "f1", segment: "header", path: "issuer", min: 1 }, { metric: "f1", scope: "micro", path: "issuer", min: 1 }],
    });
    expect(build).toThrow(EvalSpecError);
    try {
      build();
    } catch (error) {
      expect((error as EvalSpecError).problems.map((problem) => `${problem.path}: ${problem.message}`)).toEqual([
        expect.stringMatching(/^thresholds\[0\]: unknown metric f2; the result has precision, recall, f1, /u),
        "thresholds[1]: scope applies to precision, recall and f1, not errorRate",
        "thresholds[2]: a threshold needs min or max",
        "thresholds[3]: a threshold takes at most one of segment, slice and path",
        "thresholds[4]: path thresholds support precision, recall and f1 at run scope",
      ]);
    }
  });
});
