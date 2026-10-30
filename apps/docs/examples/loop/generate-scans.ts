import { digital, scan, writeCorpus } from "@docture/synthetic/node";
import { model, template } from "./model.js";

const report = await writeCorpus("corpus", {
  model,
  templates: [template],
  seeds: [1, 2, 3],
  renditions: [digital(), scan({ severity: 0.4, dpi: 100 })],
  createdAt: "2026-01-01T00:00:00Z",
});
if (report.failed.length > 0) throw new Error(JSON.stringify(report.failed));
console.log(`${report.written + report.skipped} digital and scan cases ready in corpus/manifest.jsonl`);
