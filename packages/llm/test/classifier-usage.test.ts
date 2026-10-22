import { expect, it } from "vitest";
import { z } from "zod";
import { createExtractor } from "@docture/core";
import { inMemoryLoader, loadedDocument } from "@docture/testing";
import { LLM, llm, llmClassifier, memoryCache } from "../src/index.js";
import { mockModel } from "./mock-model.js";

const text = "Invoice INV-1 for widgets, total due 60.00 EUR, thank you.";
const schema = z.object({ value: z.string() });
const candidates = [{ name: "invoice", description: "An invoice", schema }];
const pricing = { "mock-model": { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 } };
const verdict = { name: "invoice", confidence: 0.9, reason: "Invoice heading" };

it("counts all executed signals even when extraction replaces the classification", async () => {
  const result = await createExtractor({
    loaders: [inMemoryLoader(loadedDocument([text]))], classifications: candidates,
    classifiers: [
      { name: "winner", async classify() { return { classifier: "winner", name: "invoice", confidence: 1, usage: { inputTokens: 10, costUsd: 1 } }; } },
      { name: "abstain", async classify() { return { classifier: "abstain", name: null, confidence: 0, usage: { inputTokens: 20, costUsd: 2 } }; } },
    ],
    strategies: [{ name: "replacement", needsClassification: "hint", async extract() {
      return { data: { value: "ok" }, usage: { inputTokens: 30, costUsd: 3 }, classification: {
        name: "invoice", confidence: 1, signals: [{ classifier: "replacement", name: "invoice", confidence: 1, usage: { inputTokens: 999, costUsd: 999 } }],
      } };
    } }],
  }).extract(new Uint8Array([1]), schema);
  expect(result.data.value).toBe("ok");
  expect(result.usage.inputTokens).toBe(60);
  expect(result.usage.costUsd).toBe(6);
});

it("includes classifier usage and cost alongside extraction", async () => {
  const { model, calls } = mockModel([verdict, { value: "ok" }]);
  const result = await createExtractor({
    loaders: [inMemoryLoader(loadedDocument([text]))],
    classifiers: [llmClassifier({ model, pricing })], classifications: candidates,
    strategies: [llm({ model, pricing })],
  }).extract(new Uint8Array([1]), schema);
  expect(calls).toHaveLength(2);
  expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 50, totalTokens: 250, costUsd: 250 });
  expect(result.classification?.signals[0]?.usage).toMatchObject({ inputTokens: 100, outputTokens: 25, totalTokens: 125, costUsd: 125 });
});

it("reports cached classifier tokens without charging again", async () => {
  const { model, calls } = mockModel([verdict, { value: "ok" }]);
  const cache = memoryCache();
  const extractor = createExtractor({
    loaders: [inMemoryLoader(loadedDocument([text]))],
    classifiers: [llmClassifier({ model, pricing, cache })], classifications: candidates,
    strategies: [llm({ model, pricing, cache })],
  });
  await extractor.extract(new Uint8Array([1]), schema);
  const hit = await extractor.extract(new Uint8Array([1]), schema);
  expect(calls).toHaveLength(2);
  expect(hit.classification?.signals[0]?.usage).toMatchObject({ inputTokens: 100, outputTokens: 25, totalTokens: 125 });
  expect(hit.classification?.signals[0]?.usage?.costUsd).toBeUndefined();
  expect(hit.usage.inputTokens).toBe(200);
  expect(hit.usage.costUsd).toBeUndefined();
});

it("applies fluent classifier instructions and pricing", async () => {
  const { model, calls } = mockModel([verdict]);
  const extractor = createExtractor({
    loaders: [inMemoryLoader(loadedDocument([text]))],
    classifiers: [new LLM(model, { pricing, instructions: "Prefer receipt" }).classifier()],
    strategies: [llm({ model })], classifications: candidates,
  });
  const result = await extractor.classify(new Uint8Array([1]));
  expect(JSON.stringify(calls[0]?.prompt)).toContain("Prefer receipt");
  expect(result.signals[0]?.usage?.costUsd).toBe(125);
});

it.each(["UNKNOWN", "invented"])("retains paid usage for %s abstentions", async (name) => {
  const { model } = mockModel([{ ...verdict, name }, { value: "ok" }]);
  const result = await createExtractor({
    loaders: [inMemoryLoader(loadedDocument([text]))], classifiers: [llmClassifier({ model, pricing })],
    classifications: candidates, strategies: [llm({ model, pricing })],
  }).extract(new Uint8Array([1]), schema);
  expect(result.classification?.name).toBe("UNKNOWN");
  expect(result.classification?.signals[0]?.usage?.costUsd).toBe(125);
  expect(result.usage.costUsd).toBe(250);
});
