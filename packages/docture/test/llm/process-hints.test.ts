import { expect, it } from "vitest";
import { z } from "zod";
import { Extractor, Process, SplittingStrategy, defineClassification } from "docture";
import { llm } from "docture/llm/text";
import { LlmClassifier } from "docture/llm/classifier";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { fakeSplitter, PDF_BYTES } from "../core/fakes.js";
import { mockModel } from "./mock-model.js";

it.each(["splitter", "classifier"])("sends Process classification hints selected by a %s to the extraction prompt", async (selection) => {
  const { model, calls } = mockModel([{ invoiceNumber: "INV-1" }]);
  const loader = inMemoryLoader(loadedDocument(selection === "splitter" ? [
    "INVOICE INV-1 for widgets, total due 60.00 EUR, thank you.",
    "INVOICE INV-1 continues with the remaining line items here.",
  ] : ["INVOICE INV-1 for widgets, total due 60.00 EUR, thank you."]));
  const extractor = new Extractor().loadDocumentLoader(loader).loadStrategy(llm({ model }));
  const invoice = defineClassification({
    name: "invoice", description: "An invoice", hints: "PROCESS_HINT_SENTINEL",
    schema: z.object({ invoiceNumber: z.string() }),
  });
  const receipt = defineClassification({ name: "receipt", description: "A receipt", hints: "OTHER_PROCESS_HINT", schema: z.object({ merchant: z.string() }) });
  const process = new Process().loadExtractor(extractor).loadFile(PDF_BYTES);
  if (selection === "splitter") {
    process.loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2], classification: "invoice" }] }));
    process.split([invoice, receipt], SplittingStrategy.EAGER);
  } else {
    extractor.loadClassifier({ name: "fixed", async classify() { return { classifier: "fixed", name: "invoice", confidence: 1 }; } });
    process.split([invoice, receipt]);
  }
  const results = await process.extract();
  expect(results.map((result) => ({ name: result.name, data: result.data }))).toEqual([
    { name: "invoice", data: { invoiceNumber: "INV-1" } },
  ]);
  const request = JSON.stringify(calls);
  expect(request).toContain("PROCESS_HINT_SENTINEL");
  expect(request).not.toContain("OTHER_PROCESS_HINT");
});

it.each(["splitter", "classifier"])("keeps Process classifier calls and extraction usage unchanged after selection by a %s", async (selection) => {
  const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
  const classification = mockModel([{ name: "invoice", confidence: 0.9, reason: "Invoice header" }]);
  const loader = inMemoryLoader(loadedDocument(selection === "splitter" ? [
    "INVOICE INV-1 for widgets, total due 60.00 EUR, thank you.",
    "INVOICE INV-1 continues with the remaining line items here.",
  ] : ["INVOICE INV-1 for widgets, total due 60.00 EUR, thank you."]));
  const extractor = new Extractor().loadDocumentLoader(loader)
    .loadStrategy(llm({ model: extraction.model }))
    .loadClassifier(new LlmClassifier({ model: classification.model }));
  const invoice = defineClassification({ name: "invoice", description: "An invoice", schema: z.object({ invoiceNumber: z.string() }) });
  const receipt = defineClassification({ name: "receipt", description: "A receipt", schema: z.object({ merchant: z.string() }) });
  const process = new Process().loadExtractor(extractor).loadFile(PDF_BYTES);
  if (selection === "splitter") {
    process.loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2], classification: "invoice" }] }));
    process.split([invoice, receipt], SplittingStrategy.EAGER);
  } else {
    process.split([invoice, receipt]);
  }
  const results = await process.extract();
  expect(results.map((result) => ({ name: result.name, data: result.data }))).toEqual([
    { name: "invoice", data: { invoiceNumber: "INV-1" } },
  ]);
  expect(classification.calls).toHaveLength(selection === "splitter" ? 0 : 1);
  expect(extraction.calls).toHaveLength(1);
  expect(results.map((result) => result.result.usage.inputTokens)).toEqual([100]);
});

it.each(["extractor defaults", "caller options"])("sends Process-selected hints while preserving classification from %s", async (source) => {
  const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
  const classification = mockModel([{ name: "receipt", confidence: 0.9, reason: "Receipt header" }]);
  const invoice = defineClassification({ name: "invoice", description: "An invoice", hints: "SELECTED_INVOICE_HINT", schema: z.object({ invoiceNumber: z.string() }) });
  const receipt = defineClassification({ name: "receipt", description: "A receipt", hints: "UNRELATED_RECEIPT_HINT", schema: z.object({ merchant: z.string() }) });
  const extractor = new Extractor()
    .loadDocumentLoader(inMemoryLoader(loadedDocument([
      "INVOICE INV-1 for widgets, total due 60.00 EUR, thank you.",
      "INVOICE INV-1 continues with the remaining line items here.",
    ])))
    .loadStrategy(llm({ model: extraction.model }))
    .loadClassifier(new LlmClassifier({ model: classification.model }));
  if (source === "extractor defaults") extractor.loadClassifications(receipt);
  const results = await new Process().loadExtractor(extractor)
    .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2], classification: "invoice" }] }))
    .loadFile(PDF_BYTES).split([invoice, receipt], SplittingStrategy.EAGER)
    .extract(source === "caller options" ? { classifications: [receipt] } : {});
  expect(classification.calls).toHaveLength(1);
  expect(extraction.calls).toHaveLength(1);
  expect(results[0]?.result.classification?.name).toBe("receipt");
  expect(results[0]?.result.usage.inputTokens).toBe(200);
  expect(results[0]?.data).toEqual({ invoiceNumber: "INV-1" });
  const request = JSON.stringify(extraction.calls);
  expect(request).toContain("SELECTED_INVOICE_HINT");
  expect(request).not.toContain("UNRELATED_RECEIPT_HINT");
});

it("sends Process-selected hints through a structural extractor that spreads its options", async () => {
  const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
  const loader = inMemoryLoader(loadedDocument(["INVOICE INV-1 for widgets, total due 60.00 EUR, thank you."]));
  const extractor = new Extractor().loadDocumentLoader(loader).loadStrategy(llm({ model: extraction.model }));
  const invoice = defineClassification({
    name: "invoice", description: "An invoice", hints: "FORWARDED_PROCESS_HINT",
    schema: z.object({ invoiceNumber: z.string() }),
    extractor: { extractResult: (source, contract, options) => extractor.extractResult(source, contract, { ...options }) },
  });
  const results = await new Process()
    .loadDocumentLoader(loader)
    .loadFile(PDF_BYTES).split([invoice]).extract();
  expect(results[0]?.data).toEqual({ invoiceNumber: "INV-1" });
  expect(JSON.stringify(extraction.calls)).toContain("FORWARDED_PROCESS_HINT");
});

it("keeps an unhinted Process selection from borrowing another candidate's hints", async () => {
  const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
  const classification = mockModel([{ name: "receipt", confidence: 0.9, reason: "Receipt header" }]);
  const invoice = defineClassification({ name: "invoice", description: "An invoice", schema: z.object({ invoiceNumber: z.string() }) });
  const receipt = defineClassification({ name: "receipt", description: "A receipt", hints: "UNRELATED_RECEIPT_HINT", schema: z.object({ merchant: z.string() }) });
  const extractor = new Extractor()
    .loadDocumentLoader(inMemoryLoader(loadedDocument([
      "INVOICE INV-1 for widgets, total due 60.00 EUR, thank you.",
      "INVOICE INV-1 continues with the remaining line items here.",
    ])))
    .loadStrategy(llm({ model: extraction.model }))
    .loadClassifier(new LlmClassifier({ model: classification.model }))
    .loadClassifications(receipt);
  const results = await new Process().loadExtractor(extractor)
    .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2], classification: "invoice" }] }))
    .loadFile(PDF_BYTES).split([invoice, receipt], SplittingStrategy.EAGER).extract();
  expect(results[0]?.data).toEqual({ invoiceNumber: "INV-1" });
  expect(classification.calls).toHaveLength(1);
  expect(results[0]?.result.classification?.name).toBe("receipt");
  expect(results[0]?.result.usage.inputTokens).toBe(200);
  expect(JSON.stringify(extraction.calls)).not.toContain("UNRELATED_RECEIPT_HINT");
});

