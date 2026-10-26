import { expect, it } from "vitest";
import { z } from "zod";
import { Extractor, Process, contract, defineClassification } from "docture";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { PDF_BYTES } from "../core/fakes.js";
import { mockModel } from "./mock-model.js";

it.each([
  ["falls back to contract hints", undefined, true],
  ["keeps an empty classification hint", "", false],
])("Process extraction-contract guidance %s", async (_label, hints, includesFallback) => {
  const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
  const schema = z.object({ invoiceNumber: z.string() });
  const invoice = defineClassification({
    name: "invoice", description: "An invoice", schema,
    extractionContract: contract({ name: "invoice", schema, hints: "EXTRACTION_CONTRACT_HINT" }),
    ...(hints === undefined ? {} : { hints }),
  });
  const extractor = new Extractor()
    .loadDocumentLoader(inMemoryLoader(loadedDocument(["INVOICE INV-1 for widgets, total due 60.00 EUR, thank you."])))
    .loadStrategy(llm({ model: extraction.model }));
  const results = await new Process().loadExtractor(extractor).loadFile(PDF_BYTES).split([invoice]).extract();
  expect(results[0]?.data).toEqual({ invoiceNumber: "INV-1" });
  expect(JSON.stringify(extraction.calls).includes("EXTRACTION_CONTRACT_HINT")).toBe(includesFallback);
});
