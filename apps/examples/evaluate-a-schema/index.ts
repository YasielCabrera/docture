import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineEval, exact, number, type Dataset } from "@docture/eval";
import { fromDocture } from "@docture/eval/docture";
import { fileDocument } from "@docture/eval/node";
import { markdownReporter } from "@docture/eval/reporters/markdown";
import { renderScoreboard } from "@docture/eval/reporters/terminal";
import { runEval } from "@docture/eval/runner";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";
import { Invoice, invoiceParser } from "./invoice.js";

export const invoiceSpec = defineEval(Invoice, {
  strings: exact(),
  fields: { total: number({ abs: 0.005 }) },
});

export const dataset: Dataset<z.infer<typeof Invoice>> = {
  id: "invoices",
  async cases() {
    return Promise.all(["invoice", "tax-invoice"].map(async (id) => ({
      id,
      documents: [fileDocument(fileURLToPath(new URL(`./${id}.pdf`, import.meta.url)))],
      expected: Invoice.parse(JSON.parse(await readFile(new URL(`./${id}.truth.json`, import.meta.url), "utf8"))),
    })));
  },
};

export async function runExample(output = new URL("./output/", import.meta.url)) {
  await mkdir(output, { recursive: true });
  const extractor = new Extractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [invoiceParser] });
  return runEval({
    dataset,
    spec: invoiceSpec,
    experiments: fromDocture(extractor, Invoice, { id: "parser" }),
    gate: { thresholds: [{ metric: "f1", min: 1 }] },
    reporters: [markdownReporter({ out: fileURLToPath(new URL("report.md", output)) })],
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runExample();
  console.log(renderScoreboard(result));
  if (!result.gate?.pass) process.exitCode = 1;
}
