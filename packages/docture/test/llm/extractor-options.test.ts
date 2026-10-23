import { expect, it } from "vitest";
import { APICallError } from "ai";
import { z } from "zod";
import { withRasterizer, type Rasterizer } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { createLlmExtractor, memoryCache } from "../../src/llm/index.js";
import { mockModel } from "./mock-model.js";

const schema = z.object({ value: z.string() });
const pricing = { "mock-model": { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 } };

it("shares classification cache and common model options", async () => {
  const { model, calls } = mockModel([{ name: "invoice", confidence: 0.9, reason: "Invoice" }, { value: "ok" }]);
  const cache = memoryCache();
  const make = () => createLlmExtractor({
    loaders: [inMemoryLoader(loadedDocument(["An invoice with more than fifty characters of text, total 60 EUR."]))],
    model, classifyWithModel: true, classifications: [{ name: "invoice", description: "Invoice", schema: z.object({ value: z.string() }) }],
    llm: { cache, pricing, instructions: "Shared instructions", temperature: 0.4, maxRetries: 0 },
  });
  const first = await make().extract(new Uint8Array([1]), schema);
  const second = await make().extract(new Uint8Array([1]), schema);
  expect(calls).toHaveLength(2);
  expect(first.classification?.signals[0]?.usage?.costUsd).toBe(125);
  expect(second.usage.costUsd).toBeUndefined();
  expect(JSON.stringify(calls[0]?.prompt)).toContain("Shared instructions");
  expect(model.doGenerateCalls[0]?.temperature).toBe(0.4);
});

const raster: Rasterizer = {
  name: "stub", formats: ["png"],
  async rasterize(_document, options) {
    return (options.pages ?? [1]).map(pageNumber => ({ pageNumber, bytes: new Uint8Array([1]), widthPx: 1, heightPx: 1, format: "png" as const, scale: 1 }));
  },
};

it("shares vision cache and pricing without forwarding text identity", async () => {
  const { model, calls } = mockModel([{ value: "ok" }]);
  const cache = memoryCache();
  const make = () => createLlmExtractor({
    loaders: [withRasterizer(inMemoryLoader(loadedDocument([""])), raster)], model, vision: true,
    llm: { name: "text-only-name", system: "Text-only system", hints: { invoice: "Text-only hint" }, maxCharsPerRequest: 1, cache, pricing, instructions: "Shared instructions", temperature: 0.4, maxRetries: 0 },
  });
  const first = await make().extract(new Uint8Array([1]), schema);
  await make().extract(new Uint8Array([1]), schema);
  expect(calls).toHaveLength(1);
  expect(first.method).toBe("vision");
  expect(first.usage.costUsd).toBe(125);
  expect(JSON.stringify(calls[0]?.prompt)).toContain("Shared instructions");
  expect(JSON.stringify(calls[0]?.prompt)).not.toContain("Text-only system");
  expect(model.doGenerateCalls[0]?.temperature).toBe(0.4);
});

it("lets explicit vision options override shared options", async () => {
  const { model, calls } = mockModel([{ value: "ok" }]);
  const result = await createLlmExtractor({
    loaders: [withRasterizer(inMemoryLoader(loadedDocument([""])), raster)], model,
    llm: { pricing, instructions: "Shared", temperature: 0.4 },
    vision: { instructions: "Vision override", temperature: 0.1 },
  }).extract(new Uint8Array([1]), schema);
  expect(result.usage.costUsd).toBe(125);
  expect(JSON.stringify(calls[0]?.prompt)).toContain("Vision override");
  expect(model.doGenerateCalls[0]?.temperature).toBe(0.1);
});

it.each(["classifier", "vision"] as const)("shares zero retries with %s calls", async (component) => {
  const { model } = mockModel([component === "classifier"
    ? { name: "invoice", confidence: 0.9, reason: "Invoice" }
    : { value: "ok" }]);
  const generate = model.doGenerate.bind(model);
  let attempts = 0;
  model.doGenerate = async (options) => {
    attempts += 1;
    if (attempts === 1) {
      throw new APICallError({
        message: "Rate limited",
        url: "https://model.test/generate",
        requestBodyValues: {},
        statusCode: 429,
        isRetryable: true,
      });
    }
    return generate(options);
  };
  const loader = component === "classifier"
    ? inMemoryLoader(loadedDocument(["An invoice with more than fifty characters of text, total 60 EUR."]))
    : withRasterizer(inMemoryLoader(loadedDocument([""])), raster);
  const extractor = createLlmExtractor({
    loaders: [loader], model, llm: { maxRetries: 0 },
    ...(component === "classifier"
      ? { classifyWithModel: true, classifications: [{ name: "invoice", description: "Invoice", schema }] }
      : { vision: true }),
  });

  if (component === "classifier") {
    const result = await extractor.classify(new Uint8Array([1]));
    expect(result.name).toBe("UNKNOWN");
    expect(result.signals[0]).toMatchObject({ classifier: "llm-classifier", name: null, confidence: 0 });
  } else {
    const result = await extractor.safeExtract(new Uint8Array([1]), schema);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the rate limit to stop extraction");
    expect(result.error).toMatchObject({ code: "EXTRACTION_FAILED", attempts: [{ strategy: "vision", status: "failed" }] });
  }
  expect(attempts).toBe(1);
});
