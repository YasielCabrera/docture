import { buildResult, defineEval, hungarian, type BuildResultInput, type EvalResult } from "../../src/index.js";
import { Invoice, invoice, invoiceRules } from "./invoice.js";
import { errored, runInfo, scored, skipped } from "./run.js";

export const wrongInvoice = invoice({
  issuer: "Southwind Trading",
  lineItems: [{ sku: "A-100", description: "Steel bolts", amount: 10 }, { sku: "B-200", description: "Washers", amount: 25 }],
});

const greedySpec = defineEval(Invoice, { ...invoiceRules, arrays: { lineItems: hungarian({ maxCells: 1 }) } });

/** Two experiments over three cases: llm runs two epochs and errors once; parser skips one case and drops a row in another. */
export function sampleRows(): BuildResultInput["cases"] {
  const truth = invoice();
  return [
    scored({ experiment: "llm", caseId: "c1", rendition: "digital", group: "g1", ms: 100, usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.01 } }, truth, invoice()),
    scored({ experiment: "llm", caseId: "c2", rendition: "scan", group: "g1", ms: 200, usage: { inputTokens: 1500, outputTokens: 300, costUsd: 0.02 }, fallback: true }, truth, wrongInvoice),
    errored({ experiment: "llm", caseId: "c3", rendition: "scan", group: "g2", ms: 300 }, truth),
    scored({ experiment: "llm", caseId: "c1", epoch: 1, rendition: "digital", group: "g1", ms: 120 }, truth, invoice()),
    scored({ experiment: "llm", caseId: "c2", epoch: 1, rendition: "scan", group: "g1", ms: 220 }, truth, invoice()),
    errored({ experiment: "llm", caseId: "c3", epoch: 1, rendition: "scan", group: "g2", ms: 320 }, truth),
    scored({ experiment: "parser", caseId: "c1", rendition: "digital", group: "g1", ms: 10 }, truth, invoice()),
    skipped({ experiment: "parser", caseId: "c2", rendition: "scan", group: "g1", ms: 1 }, "scanned input"),
    scored({ experiment: "parser", caseId: "c3", rendition: "scan", group: "g2", ms: 12 }, truth, invoice({ lineItems: [truth.lineItems[0]!] }), greedySpec),
  ];
}

export function sampleResult(extra: Partial<BuildResultInput> = {}): EvalResult {
  return buildResult({ run: runInfo(["llm", "parser"], 2), cases: sampleRows(), ...extra });
}
