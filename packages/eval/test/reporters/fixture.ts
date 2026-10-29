import { readFileSync } from "node:fs";
import { buildResult, gate, parseEvalResult, type CalibrationReport, type EvalResult, type GroundingReport, type RunComparison } from "../../src/index.js";
import { invoice } from "../support/invoice.js";
import { errored, runInfo, scored, skipped } from "../support/run.js";
import { wrongInvoice } from "../support/sample-result.js";

/** A case id that is hostile to every output format: markup, entities, quotes, a pipe and a leading formula sign. */
export const WEIRD_ID = `=HYPERLINK("x")|<b>&'c'`;

const calibration: CalibrationReport = {
  bins: 2,
  by: "pattern",
  targetPrecision: 0.95,
  minSupport: 1,
  experiments: {
    llm: {
      graded: 26,
      omissions: 2,
      overall: {
        support: 20,
        groundTruth: 25,
        scores: [{ confidence: 0.9, count: 10, correct: 10 }, { confidence: 0.6, count: 6, correct: 5 }, { confidence: 0.3, count: 4, correct: 1 }],
        bins: [
          { lower: 0, upper: 0.5, count: 4, correct: 1, confidenceSum: 1.2, confidenceSquaredSum: 0.4, correctConfidenceSum: 0.3 },
          { lower: 0.5, upper: 1, count: 16, correct: 15, confidenceSum: 14.4, confidenceSquaredSum: 13, correctConfidenceSum: 13.6 },
        ],
        ece: 0.045, mce: 0.1, brier: 0.08, auroc: 0.91, averagePrecision: 0.97,
        riskCoverage: [{ threshold: 0.5, coverage: 0.8, accuracy: 0.9375 }, { threshold: 0.9, coverage: 0.5, accuracy: 1 }],
        accuracyAtCoverage: { "0.5": 1, "0.8": 0.9375, "1": 0.8 },
        coverageAtAccuracy: { "0.9": 0.8, "0.99": 0.5, "1": 0.5 },
        coverageAtPrecision: 0.6, threshold: 0.9,
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
      cases: { labelled: 2, unlabelled: 1 },
      overall: { predicted: 7, labelled: 8, correct: 7, supported: 6, grounded: 6, withEvidence: 7, hallucinated: 1, groundedPrecision: 6 / 7, groundedRecall: 0.75, groundedF1: 0.8 },
      patterns: { issuer: { predicted: 2, labelled: 2, correct: 2, supported: 2, grounded: 2, withEvidence: 2, hallucinated: 0, groundedPrecision: 1, groundedRecall: 1, groundedF1: 1 } },
      segments: { header: { predicted: 2, labelled: 2, correct: 2, supported: 2, grounded: 2, withEvidence: 2, hallucinated: 0, groundedPrecision: 1, groundedRecall: 1, groundedF1: 1 } },
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
      pairs: { paired: 3, baselineOnly: 0, candidateOnly: 1 },
      metrics: [
        { metric: "f1", baseline: 0.8, candidate: 0.82, summaryDelta: 0.02, pairedDelta: -0.05, ci: [-0.09, -0.01], p: 0.0004, test: "bootstrap", verdict: "regressed", n: 3 },
        { metric: "exactRate", baseline: 0.25, candidate: 0.5, summaryDelta: 0.25, pairedDelta: 0.25, ci: null, p: 0.5, test: "mcnemar", verdict: "inconclusive", n: 4 },
      ],
      segments: { totals: [{ metric: "f1", baseline: 1, candidate: 1, summaryDelta: 0, pairedDelta: 0, ci: null, p: null, test: "none", verdict: "unchanged", n: 3 }] },
      slices: {},
      paths: [{
        pattern: "lineItems[].amount",
        counts: { baseline: { match: 2, mismatch: 0, omission: 0, hallucination: 0 }, candidate: { match: 1, mismatch: 1, omission: 0, hallucination: 0 } },
        f1: { metric: "f1", baseline: 1, candidate: 0.5, summaryDelta: -0.5, pairedDelta: -0.5, ci: null, p: null, test: "none", verdict: "insufficient", n: 2 },
      }],
      cases: {
        regressed: [{ caseId: "c2", epoch: 0, metric: "f1", baseline: 1, candidate: 0.846 }],
        improved: [],
        newlyErrored: [{ caseId: "c3", epoch: 0, baseline: "scored", candidate: "errored" }],
        fixed: [],
      },
    },
    parser: {
      baseline: "parser", candidate: "parser",
      pairs: { paired: 3, baselineOnly: 0, candidateOnly: 0 },
      metrics: [
        { metric: "f1", baseline: 0.8, candidate: 0.9, summaryDelta: 0.1, pairedDelta: 0.1, ci: [0.05, 0.15], p: 0.001, test: "bootstrap", verdict: "improved", n: 3 },
        { metric: "costUsd", baseline: 1, candidate: 2, summaryDelta: 1, pairedDelta: null, ci: null, p: null, test: "none", verdict: "not-tested", n: 0 },
        { metric: "anls", baseline: null, candidate: 0.9, summaryDelta: null, pairedDelta: null, ci: null, p: null, test: "none", verdict: "incomparable", n: 0 },
      ],
      segments: {}, slices: {}, paths: [],
      cases: { regressed: [], improved: [{ caseId: "c1", epoch: 1, metric: "f1", baseline: 0.8, candidate: 0.9 }], newlyErrored: [], fixed: [{ caseId: "c2", epoch: 1, baseline: "errored", candidate: "scored" }] },
    },
  },
};

/** Scored, errored and skipped rows over two experiments with every optional section, built through `buildResult`. */
export function reporterResult(): EvalResult {
  const truth = invoice();
  const cases = [
    scored({ experiment: "llm", caseId: "c1", rendition: "digital", group: "g1", ms: 840, usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.012 } }, truth, invoice()),
    scored({ experiment: "llm", caseId: "c2", rendition: "scan", group: "g1", ms: 1520, usage: { inputTokens: 1500, outputTokens: 300, costUsd: 0.018 }, fallback: true }, truth, wrongInvoice),
    errored({ experiment: "llm", caseId: "c3", rendition: "scan", group: "g2", ms: 300 }, truth),
    scored({ experiment: "llm", caseId: WEIRD_ID, rendition: "digital", group: "g3", ms: 910 }, truth, invoice({ issuer: "=SUM(A1)", issueDate: "2024-05-03" })),
    scored({ experiment: "parser", caseId: "c1", rendition: "digital", group: "g1", ms: 12 }, truth, invoice()),
    skipped({ experiment: "parser", caseId: "c2", rendition: "scan", group: "g1", ms: 1 }, "scanned input"),
    scored({ experiment: "parser", caseId: "c3", rendition: "scan", group: "g2", ms: 15 }, truth, invoice({ lineItems: [truth.lineItems[0]!] })),
  ];
  const run = { ...runInfo(["llm", "parser"]), dataset: { id: "invoices", size: 4, fingerprint: "00000000000000aa" } };
  const base = buildResult({ run, cases, calibration, grounding, comparison, warnings: ["Spec changed since the baseline run."] });
  return { ...base, gate: gate(base, { thresholds: [{ metric: "f1", min: 0.8 }], maxErrorRate: 0.5, regressions: { maxDrop: { f1: 0.02 } } }) };
}

/** The saved fixture, read back the way a stored run is read. */
export function savedResult(): EvalResult {
  return parseEvalResult(JSON.parse(readFileSync(new URL("../fixtures/reporters/result.json", import.meta.url), "utf8")));
}
