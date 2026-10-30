import { defineEval, exact, number } from "@docture/eval";
import { fromDocture } from "@docture/eval/docture";
import { jsonlDataset, writeEvalResult } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import { extractor } from "./extractor.js";
import { Invoice } from "./invoice.js";

const result = await runEval({
  dataset: jsonlDataset("corpus/manifest.jsonl", {
    toExpected: (json) => Invoice.parse(json),
  }),
  spec: defineEval(Invoice, {
    fields: { invoiceNumber: exact(), totalCents: number() },
  }),
  experiments: fromDocture(extractor, Invoice, { id: "read-labels" }),
});

await writeEvalResult("evaluation", result);
const summary = result.summary["read-labels"];
console.log(`${summary?.cases.scored}/${summary?.cases.total} cases scored`);
console.log(`F1: ${summary?.overall.f1}`);
console.log(`Error rate: ${summary?.overall.errorRate}`);
