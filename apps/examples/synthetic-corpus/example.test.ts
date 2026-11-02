import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { runExample } from "./index.js";
import { invoiceModel } from "./model.js";

it("derives reproducible totals from the sampled quantity and price", async () => {
  const sample = await invoiceModel.sample({ seed: 1 });
  expect(await invoiceModel.sample({ seed: 1 })).toEqual(sample);
  expect(sample.value.totalCents).toBe(sample.value.quantity * sample.value.unitPriceCents);
});

it("writes digital and scanned corpus cases and skips unchanged reruns", async () => {
  const output = await mkdtemp(join(tmpdir(), "docture-synthetic-example-"));
  const report = await runExample(output);
  expect(report).toMatchObject({ written: 4, skipped: 0, failed: [] });
  expect(await runExample(output)).toMatchObject({ written: 0, skipped: 4, failed: [] });
  const sample = await new DocumentLoaderPdfJs().load(
    { bytes: await readFile(join(output, "sample.pdf")), mimeType: "application/pdf" },
    { signal: AbortSignal.timeout(30_000), logger: silentLogger },
  );
  expect(sample.text).toContain("Invoice: INV-53631");
  expect(sample.text).toContain("Total: $10.70");
  expect(JSON.parse(await readFile(join(output, "sample.truth.json"), "utf8"))).toMatchObject({ invoiceNumber: "INV-53631", totalCents: 1070 });
}, 60_000);
