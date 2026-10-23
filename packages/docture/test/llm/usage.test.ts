import { expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createExtractor, withRasterizer, type Rasterizer } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { llm, memoryCache, toUsage, vision } from "../../src/llm/index.js";

const pricing = { "cache-model": { inputPerMillion: 2, outputPerMillion: 4, cacheReadPerMillion: 0.2, cacheWritePerMillion: 3 } };
const raw = { inputTokens: 1000, outputTokens: 25, inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100 } };

it("prices cache reads and writes at their configured rates", () => {
  const usage = toUsage(raw, 1, "cache-model", pricing);
  expect(usage.costUsd).toBe((100 * 2 + 800 * 0.2 + 100 * 3 + 25 * 4) / 1e6);
  expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 25, totalTokens: 1025, cacheReadTokens: 800, cacheWriteTokens: 100 });
  expect(toUsage({ inputTokens: 1000, inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 900 } }, 0, "cache-model", pricing).costUsd).toBe((100 * 2 + 900 * 0.2) / 1e6);
});

it("falls back to input pricing without cache rates or a breakdown", () => {
  const ordinary = { "cache-model": { inputPerMillion: 2, outputPerMillion: 4 } };
  expect(toUsage(raw, 0, "cache-model", ordinary).costUsd).toBe((1000 * 2 + 25 * 4) / 1e6);
  expect(toUsage({ inputTokens: 1000, outputTokens: 25 }, 0, "cache-model", pricing).costUsd).toBe((1000 * 2 + 25 * 4) / 1e6);
  expect(toUsage(raw, 0).costUsd).toBeUndefined();
  expect(toUsage({ inputTokens: 1000, inputTokenDetails: { cacheReadTokens: 900 } }, 0, "cache-model", pricing).costUsd).toBe((100 * 2 + 900 * 0.2) / 1e6);
});

it("preserves floating point rounding without cache rates", () => {
  expect(toUsage({ inputTokens: 1, outputTokens: 1 }, 0, "m", { m: { inputPerMillion: 2, outputPerMillion: 10 } }).costUsd).toBe(1.1999999999999999e-5);
});

function cachedModel() {
  return new MockLanguageModelV4({
    modelId: "cache-model",
    provider: "mock",
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ value: "ok" }) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 1000, noCache: 100, cacheRead: 800, cacheWrite: 100 }, outputTokens: { total: 25, text: 25, reasoning: 0 } },
      warnings: [],
    }),
  });
}

const raster: Rasterizer = {
  name: "stub", formats: ["png"],
  async rasterize(_doc, options) {
    return (options.pages ?? [1]).map(pageNumber => ({ pageNumber, bytes: new Uint8Array([1]), widthPx: 1, heightPx: 1, format: "png" as const, scale: 1 }));
  },
};

it.each(["text", "vision"] as const)("preserves cache counters across %s parts and cache hits", async (kind) => {
  const model = cachedModel();
  const cache = memoryCache();
  const loader = withRasterizer(inMemoryLoader(loadedDocument(["A text page with more than fifty characters of content for extraction.", "Another page with more than fifty characters of content for extraction."])), raster);
  const strategy = kind === "text" ? llm({ model, cache, pricing, completion: "paginate" }) : vision({ model, cache, pricing, pageMode: "perPage" });
  const extractor = createExtractor({ loaders: [loader], strategies: [strategy] });
  const first = await extractor.extract(new Uint8Array([1]), z.object({ value: z.string() }));
  expect(first.usage).toMatchObject({ inputTokens: 2000, outputTokens: 50, totalTokens: 2050, cacheReadTokens: 1600, cacheWriteTokens: 200 });
  expect(first.usage.costUsd).toBe(2 * (100 * 2 + 800 * 0.2 + 100 * 3 + 25 * 4) / 1e6);
  const hit = await extractor.extract(new Uint8Array([1]), z.object({ value: z.string() }));
  expect(hit.usage).toMatchObject({ inputTokens: 2000, cacheReadTokens: 1600, cacheWriteTokens: 200 });
  expect(hit.usage.costUsd).toBeUndefined();
  expect(model.doGenerateCalls).toHaveLength(2);
});
