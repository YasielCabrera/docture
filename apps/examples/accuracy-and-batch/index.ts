import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineStrategy } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { looseEval } from "@docture/eval";
import { z } from "zod";

const Invoice = z.object({ invoiceNumber: z.string(), total: z.number() });
const Truth = z.array(z.object({ file: z.string(), expected: Invoice }));

export async function runExample() {
  const cases = Truth.parse(JSON.parse(await readFile(new URL("./truth.json", import.meta.url), "utf8")));
  const parser = defineStrategy({
    name: "invoice-summary",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const invoiceNumber = /Invoice No\.?\s*:?\s*(INV-\S+)/iu.exec(document.text)?.[1];
      const total = /Total due\s+[$₹]([\d,.]+)/iu.exec(document.text)?.[1];
      if (!invoiceNumber || !total) throw new Error("No supported invoice summary found.");
      return { data: { invoiceNumber, total: Number(total.replaceAll(",", "")) } };
    },
  });
  await using extractor = new Extractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [parser] });
  const scorer = looseEval();
  const results = [];
  const paths = cases.map((item) => fileURLToPath(new URL(item.file, import.meta.url)));
  for await (const item of extractor.extractBatch(paths, Invoice, { concurrency: 2 })) {
    if (!item.outcome.ok) throw item.outcome.error;
    const expected = cases[item.index]?.expected;
    if (!expected) throw new Error("The batch result has no corresponding truth.");
    const score = scorer.score(expected, item.outcome.result.data);
    results.push({ file: cases[item.index]?.file, data: item.outcome.result.data, f1: score.metrics.f1 });
  }
  return results.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? ""));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
