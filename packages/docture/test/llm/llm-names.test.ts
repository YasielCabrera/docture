import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, Extractor } from "docture";
import { createExtractor as createNodeExtractor, resolveNodeSource } from "docture/node";
import { LLM, createLlmExtractor } from "../../src/llm/index.js";
import { failingModel, mockModel } from "./mock-model.js";

const Invoice = z.object({ invoiceNumber: z.string() });
const DOCUMENT = {
  bytes: new TextEncoder().encode("INVOICE INV-42 issued today, with comfortably more than fifty characters of text."),
  mimeType: "text/plain",
};

describe("LLM component names", () => {
  it("derive from the model id", () => {
    const { model } = mockModel([{}], { modelId: "gpt-5" });
    const backend = new LLM(model);
    expect([
      backend.extraction().name,
      backend.vision().name,
      backend.classifier().name,
      backend.layout().name,
      backend.splitter().name,
    ]).toEqual(["gpt-5", "gpt-5:vision", "gpt-5:classifier", "gpt-5:layout", "gpt-5:splitter"]);
  });

  it("let two models form a fallback chain", async () => {
    const cheap = failingModel("rate limited");
    const { model: strong } = mockModel([{ invoiceNumber: "INV-42" }], { modelId: "strong" });
    const result = await new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(cheap, { name: "cheap" }))
      .loadLlm(new LLM(strong))
      .extract(DOCUMENT, Invoice);
    expect(result.data).toEqual({ invoiceNumber: "INV-42" });
    expect(result.method).toBe("strong");
    expect(result.attempts.map((attempt) => [attempt.strategy, attempt.status])).toEqual([["cheap", "failed"], ["strong", "ok"]]);
  });

  it("let one loadLlm call wire extraction and classification", async () => {
    const { model } = mockModel([{ name: "invoice", confidence: 0.9, reason: "billing" }]);
    const invoice = { name: "invoice", description: "A vendor billing a customer.", schema: Invoice };
    const receipt = { name: "receipt", description: "A point-of-sale receipt.", schema: Invoice };
    const classifying = new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(model), { classify: true });
    const decided = await classifying.classify(DOCUMENT, [invoice, receipt] as const);
    expect([decided.name, decided.confidence]).toEqual(["invoice", 0.9]);
    expect(classifying.components.strategies.map((s) => s.name)).toEqual(["mock-model"]);
  });

  it("keep a per-capability name override", () => {
    const { model } = mockModel([{}], { modelId: "gpt-5" });
    expect(new LLM(model, { extraction: { name: "text" } }).extraction().name).toBe("text");
  });
});

describe("model extractors that read local files", () => {
  it("createLlmExtractor reads a path through resolveNodeSource", async () => {
    const directory = await mkdtemp(join(tmpdir(), "docture-llm-file-"));
    try {
      const path = join(directory, "invoice.txt");
      await writeFile(path, DOCUMENT.bytes);
      const { model } = mockModel([{ invoiceNumber: "INV-42" }]);
      const extractor = createLlmExtractor({ loaders: [new DocumentLoaderData()], model, sourceResolver: resolveNodeSource });
      expect((await extractor.extract(path, Invoice)).data).toEqual({ invoiceNumber: "INV-42" });

      const { model: other } = mockModel([{ invoiceNumber: "INV-43" }]);
      const node = createNodeExtractor({ loaders: [new DocumentLoaderData()], llm: new LLM(other) });
      expect((await node.extract(path, Invoice)).data).toEqual({ invoiceNumber: "INV-43" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
