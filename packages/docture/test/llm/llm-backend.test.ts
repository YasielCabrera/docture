/**
 * `LLM` — the seam that lets core accept a model without depending on one.
 *
 * The claim: `extractor.loadLlm(new LLM(model))` produces exactly the strategies you
 * would have wired by hand, and the options given once to the `LLM` reach every one
 * of them. A cache configured on the model and missing from the classifier is the
 * bug this is here to prevent.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, Extractor } from "docture";
import {
  ImageSplitter,
  LLM,
  LlmClassifier,
  LlmStrategy,
  TextSplitter,
  VisionStrategy,
  memoryCache,
  model as makeModel,
} from "../../src/llm/index.js";
import { mockModel } from "./mock-model.js";

const Invoice = z.object({ invoiceNumber: z.string() });
const text = (body: string): { bytes: Uint8Array; mimeType: string } => ({
  bytes: new TextEncoder().encode(body),
  mimeType: "text/plain",
});

const DOCUMENT = text(
  "INVOICE INV-42 issued today, with comfortably more than fifty characters of text.",
);

describe("LLM", () => {
  it("takes its id from the model", () => {
    const { model } = mockModel([{}], { modelId: "acme/big" });
    expect(new LLM(model).id).toBe("acme/big");
  });

  it("takes an explicit name when two of the same model are wired", () => {
    const { model } = mockModel([{}]);
    expect(new LLM(model, { name: "cheap" }).id).toBe("cheap");
  });

  it("builds each kind of component", () => {
    const { model } = mockModel([{}]);
    const llm = new LLM(model);
    expect(llm.extraction()).toBeInstanceOf(LlmStrategy);
    expect(llm.vision()).toBeInstanceOf(VisionStrategy);
    expect(llm.classifier()).toBeInstanceOf(LlmClassifier);
    expect(llm.splitter()).toBeInstanceOf(TextSplitter);
  });

  it("builds an ImageSplitter when asked for one", () => {
    const { model } = mockModel([{}]);
    expect(new LLM(model, { splitter: { mode: "image" } }).splitter()).toBeInstanceOf(
      ImageSplitter,
    );
  });

  it("has a factory form", () => {
    const { model } = mockModel([{}]);
    expect(makeModel(model, { name: "n" }).id).toBe("n");
  });
});

describe("loadLlm end to end", () => {
  it("extracts through the model", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "INV-42" }]);

    const result = await new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(model))
      .extract(DOCUMENT, Invoice);

    expect(result.data.invoiceNumber).toBe("INV-42");
    expect(calls).toHaveLength(1);
  });

  it("reports token usage from the model", async () => {
    const { model } = mockModel([{ invoiceNumber: "INV-42" }], {
      inputTokens: 300,
      outputTokens: 40,
    });

    const result = await new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(model))
      .extract(DOCUMENT, Invoice);

    expect(result.usage.inputTokens).toBe(300);
    expect(result.usage.outputTokens).toBe(40);
  });

  it("prices the run when a pricing table is given once, on the model", async () => {
    const { model } = mockModel([{ invoiceNumber: "INV-42" }], {
      modelId: "acme/big",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });

    const result = await new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(model, { pricing: { "acme/big": { inputPerMillion: 3, outputPerMillion: 6 } } }))
      .extract(DOCUMENT, Invoice);

    expect(result.usage.costUsd).toBeCloseTo(3);
  });

  /** Configure once; every strategy the model makes inherits it. */
  it("shares one cache across the strategies it builds", async () => {
    const cache = memoryCache();
    const { model, calls } = mockModel([{ invoiceNumber: "INV-42" }]);
    const llm = new LLM(model, { cache });

    const build = (): Extractor =>
      new Extractor().loadDocumentLoader(new DocumentLoaderData()).loadLlm(llm);

    await build().extract(DOCUMENT, Invoice);
    await build().extract(DOCUMENT, Invoice);

    expect(calls).toHaveLength(1);
  });

  it("passes instructions through to the prompt", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "INV-42" }]);

    await new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(model, { instructions: "Amounts are in euros." }))
      .extract(DOCUMENT, Invoice);

    expect(JSON.stringify(calls[0]?.prompt)).toContain("Amounts are in euros.");
  });

  it("registers vision alongside text when asked", () => {
    const { model } = mockModel([{}]);
    const extractor = new Extractor().loadLlm(new LLM(model), { vision: true });
    expect(extractor.components.strategies).toHaveLength(2);
  });

  it("registers a classifier when asked", () => {
    const { model } = mockModel([{}]);
    const extractor = new Extractor().loadLlm(new LLM(model), { classify: true });
    expect(extractor.components.classifiers).toHaveLength(1);
  });

  /** Two models in one pipeline is the reason ids have to be distinct. */
  it("wires two models under distinct names", () => {
    const cheap = mockModel([{}], { modelId: "cheap" }).model;
    const good = mockModel([{}], { modelId: "good" }).model;

    const extractor = new Extractor()
      .loadLlm(new LLM(cheap, { extraction: { name: "cheap" } }))
      .loadLlm(new LLM(good, { extraction: { name: "good" } }));

    expect(extractor.components.strategies.map((s) => s.name)).toEqual(["cheap", "good"]);
  });
});
