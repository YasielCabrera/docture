import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digital, scan, writeCorpus } from "@docture/synthetic/node";
import { renderPdf } from "@docture/synthetic/pdfkit";
import { invoiceModel, invoiceTemplate } from "./model.js";

export async function runExample(output = fileURLToPath(new URL("./output/", import.meta.url))) {
  await mkdir(output, { recursive: true });
  const sample = await invoiceModel.sample({ seed: 1 });
  const pdf = await renderPdf(invoiceTemplate, sample, { createdAt: "2026-01-01T00:00:00Z" });
  await writeFile(join(output, "sample.pdf"), pdf.bytes);
  await writeFile(join(output, "sample.truth.json"), JSON.stringify(pdf.expected, null, 2));
  return writeCorpus(output, {
    model: invoiceModel,
    templates: [invoiceTemplate],
    seeds: [1, 2],
    renditions: [digital(), scan({ severity: 0.4, dpi: 150 })],
    createdAt: "2026-01-01T00:00:00Z",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await runExample();
  console.log(JSON.stringify(report, null, 2));
  if (report.failed.length > 0) process.exitCode = 1;
}
