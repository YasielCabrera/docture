import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RunStoreError, buildResult, defineMetric, gate, parseCaseResult, parseEvalResult, type CalibrationReport, type GroundingReport, type RunComparison } from "../src/index.js";
import { validateJsonSchema } from "./support/json-schema.js";
import { runInfo } from "./support/run.js";
import { sampleResult, sampleRows } from "./support/sample-result.js";

const schema = JSON.parse(readFileSync(new URL("../schemas/result-v1.schema.json", import.meta.url), "utf8")) as Record<string, unknown>;

const calibration: CalibrationReport = {
  bins: 2,
  by: "pattern",
  targetPrecision: 0.99,
  minSupport: 1,
  experiments: {
    llm: {
      graded: 4,
      omissions: 1,
      overall: {
        support: 2,
        groundTruth: 5,
        scores: [{ confidence: 0.9, count: 1, correct: 1 }, { confidence: 0.4, count: 1, correct: 0 }],
        bins: [{ lower: 0, upper: 0.5, count: 1, correct: 0, confidenceSum: 0.4, confidenceSquaredSum: 0.16, correctConfidenceSum: 0 }],
        ece: 0.1, mce: 0.4, brier: 0.08, auroc: 1, averagePrecision: 0.2,
        riskCoverage: [{ threshold: 0.9, coverage: 0.5, accuracy: 1 }],
        accuracyAtCoverage: { "0.5": 1, "1": 0.5 },
        coverageAtAccuracy: { "0.99": 0.5, "1": 0.5 },
        coverageAtPrecision: 0.5, threshold: 0.9,
      },
      groups: {},
    },
  },
};

const grounding: GroundingReport = {
  iou: 0.5,
  level: "box",
  experiments: {
    llm: {
      cases: { labelled: 1, unlabelled: 2 },
      overall: { predicted: 3, labelled: 4, correct: 4, supported: 3, grounded: 3, withEvidence: 3, hallucinated: 0, groundedPrecision: 1, groundedRecall: 0.75, groundedF1: 6 / 7 },
      patterns: {},
      segments: { header: { predicted: 3, labelled: 4, correct: 4, supported: 3, grounded: 3, withEvidence: 3, hallucinated: 0, groundedPrecision: 1, groundedRecall: 0.75, groundedF1: 6 / 7 } },
    },
  },
};

const comparison: RunComparison = {
  baselineRunId: "run-0",
  candidateRunId: "run-1",
  settings: { test: "auto", resamples: 10_000, seed: "eval", alpha: 0.05, cluster: "group" },
  compatible: { dataset: true, spec: true, warnings: [] },
  experiments: {
    llm: {
      baseline: "llm",
      candidate: "llm",
      pairs: { paired: 3, baselineOnly: 0, candidateOnly: 0 },
      metrics: [{ metric: "f1", baseline: 0.8, candidate: 0.769, summaryDelta: -0.031, pairedDelta: -0.03, ci: [-0.06, -0.002], p: 0.03, test: "bootstrap", verdict: "regressed", n: 3 }],
      segments: {},
      slices: {},
      paths: [{
        pattern: "issuer",
        counts: { baseline: { match: 3, mismatch: 0, omission: 0, hallucination: 0 }, candidate: { match: 2, mismatch: 1, omission: 0, hallucination: 0 } },
        f1: { metric: "f1", baseline: 1, candidate: 2 / 3, summaryDelta: -1 / 3, pairedDelta: -1 / 3, ci: null, p: null, test: "none", verdict: "insufficient", n: 3 },
      }],
      cases: {
        regressed: [{ caseId: "c2", epoch: 0, metric: "f1", baseline: 1, candidate: 0.846 }],
        improved: [],
        newlyErrored: [{ caseId: "c3", epoch: 0, baseline: "scored", candidate: "errored" }],
        fixed: [],
      },
    },
  },
};

describe("buildResult", () => {
  const result = sampleResult({ slices: { group: "group" }, calibration, grounding, comparison });

  it("summarizes precision, recall and F1 in run, micro and macro scope", () => {
    const pick = (experiment: string) => ["f1", "recall", "f1.micro", "f1.macro"].map((id) => result.summary[experiment]?.overall[id]);
    expect(pick("llm")).toEqual([100 / 130, 50 / 78, 50 / 52, (3 + 22 / 26) / 4]);
    expect(pick("parser")).toEqual([46 / 49, 23 / 26, 46 / 49, (1 + 20 / 23) / 2]);
  });

  it("summarizes outcomes, cost, tokens and latency per experiment", () => {
    const overall = result.summary.llm?.overall;
    expect([overall?.errorRate, overall?.exactRate, overall?.fallbackRate, overall?.costUsd, overall?.tokens, overall?.latencyP50, overall?.latencyP95]).toEqual([2 / 6, 0.5, 1 / 6, 0.03, 3000, 210, 315]);
    expect([result.summary.llm?.cases, result.summary.parser?.cases]).toEqual([
      { total: 6, scored: 4, errored: 2, skipped: 0 },
      { total: 3, scored: 2, errored: 0, skipped: 1 },
    ]);
    expect([result.summary.parser?.overall.skipRate, result.summary.parser?.overall.costUsd]).toEqual([1 / 3, null]);
  });

  it("reads calibration and grounding metrics from their sections", () => {
    const overall = result.summary.llm?.overall;
    expect([overall?.ece, overall?.brier, overall?.auroc, overall?.coverageAtPrecision99, overall?.groundedF1]).toEqual([0.1, 0.08, 1, 0.5, 6 / 7]);
    expect([result.summary.parser?.overall.ece, result.summary.llm?.slices.rendition?.scan?.metrics.ece]).toEqual([null, null]);
  });

  it("summarizes segments, recorded and computed slices, path patterns and field types", () => {
    const llm = result.summary.llm;
    expect(llm?.segments.header?.counts).toEqual({ match: 15, mismatch: 1, omission: 8, hallucination: 0 });
    expect(llm?.segments.header?.metrics["f1.micro"]).toBe(30 / 32);
    expect(Object.keys(llm?.slices ?? {})).toEqual(["rendition", "group"]);
    expect([llm?.slices.rendition?.digital?.cases, llm?.slices.rendition?.scan?.metrics.errorRate, llm?.slices.group?.g2?.metrics.f1]).toEqual([2, 0.5, 0]);
    expect(Object.keys(llm?.fieldTypes ?? {})).toEqual(["string", "date", "enum", "number"]);
  });

  it("counts an errored case's expected leaves as omissions in path and field-type summaries", () => {
    const llm = result.summary.llm;
    expect(llm?.paths.issuer).toEqual({ precision: 0.75, recall: 0.5, f1: 0.6, counts: { match: 3, mismatch: 1, omission: 2, hallucination: 0 }, meanSimilarity: 0.86 });
    expect(llm?.paths["lineItems[].amount"]?.counts).toEqual({ match: 7, mismatch: 1, omission: 4, hallucination: 0 });
    expect(llm?.fieldTypes.date?.counts).toEqual({ match: 4, mismatch: 0, omission: 2, hallucination: 0 });
    expect(result.summary.parser?.paths.issuer?.counts).toEqual({ match: 2, mismatch: 0, omission: 0, hallucination: 0 });
  });

  it("records an errored case's omitted leaves per segment and per path pattern", () => {
    const row = result.cases[2];
    expect(row?.outcome === "errored" ? row.omitted : undefined).toEqual({
      fields: 13,
      weight: 13,
      segments: { header: { fields: 4, weight: 4 }, totals: { fields: 3, weight: 3 }, lineItems: { fields: 6, weight: 6 } },
      paths: {
        issuer: { fields: 1, weight: 1 },
        reference: { fields: 1, weight: 1 },
        issueDate: { fields: 1, weight: 1 },
        status: { fields: 1, weight: 1 },
        "totals.net": { fields: 1, weight: 1 },
        "totals.tax": { fields: 1, weight: 1 },
        "totals.total": { fields: 1, weight: 1 },
        "lineItems[].sku": { fields: 2, weight: 2 },
        "lineItems[].description": { fields: 2, weight: 2 },
        "lineItems[].amount": { fields: 2, weight: 2 },
      },
    });
  });

  it("reports metric spread across epochs", () => {
    const f1 = result.summary.llm?.epochs?.metrics.f1;
    expect(f1?.values).toEqual([48 / 65, 0.8]);
    expect(f1?.mean).toBeCloseTo((48 / 65 + 0.8) / 2, 12);
    expect(f1?.stdev).toBeCloseTo((0.8 - 48 / 65) / Math.SQRT2, 12);
    expect(result.summary.parser?.epochs).toBe(undefined);
  });

  it("warns when alignment fell back to greedy", () => {
    expect(result.warnings).toEqual([
      "Alignment of lineItems fell back to greedy pairing in 1 case because the cost matrix exceeded its cell budget. Add a key or raise maxCells to align exactly.",
    ]);
  });

  it("stores every per-case metric value on each row and keeps values a row already carries", () => {
    const pages = defineMetric({ id: "pages", label: "Pages", direction: "lower", format: "count", perCase: (row) => (row.outcome === "skipped" ? null : 2), aggregate: () => 0 });
    const rows = sampleRows();
    const carried = { ...rows[0]!, values: { legacy: 0.5 } };
    const built = buildResult({ run: runInfo(["llm", "parser"]), cases: [carried, ...rows.slice(1)], metrics: [pages] });
    const pick = (index: number) => {
      const values = built.cases[index]?.values ?? {};
      return [values.legacy, values.pages, values.f1, values.errorRate, values.latencyP50];
    };
    expect([pick(0), pick(2), pick(7)]).toEqual([
      [0.5, 2, 1, 0, 100],
      [undefined, 2, 0, 1, 300],
      [undefined, null, null, 0, null],
    ]);
    expect(validateJsonSchema(schema, JSON.parse(JSON.stringify(built)))).toEqual([]);
  });

  it("adds custom metrics after the built-ins and rejects a repeated id", () => {
    const pages = defineMetric({ id: "pages", label: "Pages", direction: "lower", format: "count", aggregate: (rows) => rows.length * 2 });
    const custom = buildResult({ run: runInfo(["llm", "parser"]), cases: sampleRows(), metrics: [pages] });
    expect([custom.metrics.at(-1), custom.summary.llm?.overall.pages]).toEqual([{ id: "pages", label: "Pages", direction: "lower", format: "count" }, 12]);
    expect(() => buildResult({ run: runInfo(["llm"]), cases: [], metrics: [{ ...pages, id: "f1" }] })).toThrow("f1: another metric already has this id");
  });

  it("produces JSON that validates against result-v1.schema.json and parses back unchanged", () => {
    const withGate = { ...result, gate: gate(result, { thresholds: [{ metric: "f1", min: 0.9 }], regressions: { maxDrop: { f1: 0.01 } } }) };
    const json = JSON.parse(JSON.stringify(withGate)) as unknown;
    expect(validateJsonSchema(schema, json)).toEqual([]);
    expect(parseEvalResult(json)).toEqual(withGate);
  });

  it("is rejected by the schema when a case loses a required member", () => {
    const json = JSON.parse(JSON.stringify(result)) as { cases: Record<string, unknown>[] };
    delete json.cases[0]?.ms;
    expect(validateJsonSchema(schema, json)).toEqual(["$.cases[0].ms: required"]);
  });
});

describe("parseEvalResult", () => {
  const json = () => JSON.parse(JSON.stringify(sampleResult())) as Record<string, unknown> & { cases: Record<string, unknown>[] };

  it("rejects another format version with a clear error", () => {
    const next = { ...json(), version: 2 };
    expect(() => parseEvalResult(next)).toThrow("Eval result version 2 is not supported; this @docture/eval reads version 1.");
    try {
      parseEvalResult(next);
    } catch (error) {
      expect([error instanceof RunStoreError, (error as RunStoreError).reason]).toEqual([true, "version"]);
    }
  });

  it("names the first member that does not fit version 1", () => {
    const broken = json();
    broken.cases[1] = { ...broken.cases[1], outcome: "crashed" };
    expect(() => parseEvalResult(broken)).toThrow("Not a valid eval result: cases[1].outcome must be one of scored, errored, skipped.");
    expect(() => parseEvalResult({ format: "something-else" })).toThrow('Not a valid eval result: format must be "docture-eval-result".');
  });

  it("validates single case lines", () => {
    const [row] = json().cases;
    expect(parseCaseResult(row)).toEqual(row);
    expect(() => parseCaseResult({ ...row, epoch: "0" })).toThrow("Not a valid case result: epoch must be an integer.");
  });

  type Mutable = Record<string, any>;
  it.each<[string, (result: Mutable) => void, string]>([
    ["a summary metric", (result) => { result.summary.llm.overall.f1 = "high"; }, "summary.llm.overall.f1 must be a number or null"],
    ["a segment count", (result) => { result.summary.llm.segments.header.counts.match = "3"; }, "summary.llm.segments.header.counts.match must be a number"],
    ["a field status", (result) => { result.cases[0].score.fields[0].status = "close"; }, "cases[0].score.fields[0].status must be one of match, mismatch, omission, hallucination"],
    ["a case metric", (result) => { result.cases[0].score.metrics.f1 = "1"; }, "cases[0].score.metrics.f1 must be a number or null"],
    ["an alignment report", (result) => { result.cases[0].score.arrays[0] = { path: "lineItems" }; }, "cases[0].score.arrays[0].pattern is missing"],
    ["an unknown member", (result) => { result.cases[0].score.surprise = true; }, "cases[0].score.surprise is not allowed"],
    ["an omitted segment weight", (result) => { result.cases[2].omitted.segments.header.weight = null; }, "cases[2].omitted.segments.header.weight must be a number"],
    ["an omitted path count", (result) => { result.cases[2].omitted.paths.issuer = 1; }, "cases[2].omitted.paths.issuer must be an object"],
    ["a spec field", (result) => { result.run.spec.fields[0].weight = "1"; }, "run.spec.fields[0].weight must be a number"],
    ["the comparison section", (result) => { result.comparison = { baselineRunId: 1 }; }, "comparison.baselineRunId must be a string"],
    ["a comparison verdict", (result) => {
      result.comparison = structuredClone(comparison);
      result.comparison.experiments.llm.metrics[0].verdict = "no-change";
    }, "comparison.experiments.llm.metrics[0].verdict must be one of improved, regressed, unchanged, inconclusive, insufficient, not-tested, incomparable"],
    ["a case's experiment config hash", (result) => { result.cases[0].configHash = 7; }, "cases[0].configHash must be a string"],
    ["the gate section", (result) => { result.gate = { pass: "yes", checks: [] }; }, "gate.pass must be a boolean"],
    ["per-case metric values", (result) => { result.cases[0].values = { f1: "1" }; }, "cases[0].values.f1 must be a number or null"],
    ["case-level locations", (result) => { result.cases[0].locations = { issuer: [{ page: 1 }] }; }, "cases[0].locations.issuer[0].pageNumber is missing"],
  ])("rejects a wrong type in %s and names its path", (_name, mutate, message) => {
    const broken = json() as Mutable;
    mutate(broken);
    expect(() => parseEvalResult(broken)).toThrow(`Not a valid eval result: ${message}.`);
  });

  it("validates the payload of a single case line", () => {
    const [row] = json().cases as Mutable[];
    expect(() => parseCaseResult({ ...row, score: { ...row!.score, counts: { ...row!.score.counts, match: "1" } } })).toThrow("Not a valid case result: score.counts.match must be a number.");
    expect(() => parseCaseResult({ ...row, caseFingerprint: 7 })).toThrow("Not a valid case result: caseFingerprint must be a string.");
  });
});
