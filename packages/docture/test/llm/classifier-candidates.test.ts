import { expect, it } from "vitest";
import { z } from "zod";
import { silentLogger, type LoadedDocument } from "docture";
import { LlmClassifier } from "../../src/llm/index.js";
import { mockModel } from "./mock-model.js";

const document: LoadedDocument = {
  pages: [{ pageNumber: 1, width: 595, height: 842, text: "INVOICE INV-1 total due 60.00 EUR" }],
  text: "INVOICE INV-1 total due 60.00 EUR",
  form: "digital",
  loader: "memory",
};

async function classify(answer: string, names: readonly string[]) {
  const { model } = mockModel([{ name: answer, confidence: 0.8, reason: "Invoice heading" }]);
  const signal = await new LlmClassifier({ model }).classify({
    document,
    features: { mimeType: "application/pdf", pageCount: 1, textLength: 33, hasTextLayer: true, hasGeometry: false, hasRenderablePages: false, form: "digital" },
    candidates: names.map((name) => ({ name, description: `A ${name}`, schema: z.object({}) })),
    signal: new AbortController().signal,
    logger: silentLogger,
  });
  return { name: signal?.name, confidence: signal?.confidence, note: signal?.note };
}

it.each(["PurchaseOrder", " purchaseorder ", "PURCHASEORDER"])("returns the candidate's own spelling when the model answers %j", async (answer) => {
  expect(await classify(answer, ["Invoice", "PurchaseOrder"]))
    .toEqual({ name: "PurchaseOrder", confidence: 0.8, note: "Invoice heading" });
});

it("prefers the exact candidate when candidates differ only by case", async () => {
  expect(await classify("invoice", ["Invoice", "invoice"]))
    .toEqual({ name: "invoice", confidence: 0.8, note: "Invoice heading" });
});

it("abstains when an answer matches several candidates only by case", async () => {
  expect(await classify("INVOICE", ["Invoice", "invoice"])).toEqual({
    name: null,
    confidence: 0,
    note: 'returned "INVOICE", which matches more than one candidate when case is ignored',
  });
});

it("chooses a candidate named Unknown and treats unknown as abstention otherwise", async () => {
  expect(await classify("Unknown", ["Unknown", "Invoice"]))
    .toEqual({ name: "Unknown", confidence: 0.8, note: "Invoice heading" });
  expect(await classify("unknown", ["Invoice"]))
    .toEqual({ name: null, confidence: 0, note: "Invoice heading" });
});

it("abstains on a name outside the candidates", async () => {
  expect(await classify("Receipt", ["Invoice"]))
    .toEqual({ name: null, confidence: 0, note: 'returned "Receipt", which is not a candidate' });
});
