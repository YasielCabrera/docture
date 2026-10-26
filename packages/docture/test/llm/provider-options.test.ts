import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createExtractor, withRasterizer, type Rasterizer } from "docture";
import { memoryCache } from "docture/llm/cache";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const rasterizer: Rasterizer = {
  name: "image", formats: ["png"],
  async rasterize() {
    return [{ pageNumber: 1, bytes: new Uint8Array([137,80,78,71,13,10,26,10]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }];
  },
};
const schema = z.object({ value: z.string() });

describe.each(["text", "vision"] as const)("%s provider options", (kind) => {
  const strategy = kind === "text" ? llm : vision;
  const loader = () => kind === "text"
    ? inMemoryLoader(loadedDocument(["Invoice INV-42 with a total of 12.00 EUR and a complete text layer."]))
    : withRasterizer(inMemoryLoader(loadedDocument(["Invoice page"])), rasterizer);

  it("forwards provider settings without changing omitted requests", async () => {
    const received: (ProviderOptions | undefined)[] = [];
    const handle = mockModel([{ value: "accepted" }]);
    const model = new MockLanguageModelV4({
      doGenerate(options) { received.push(options.providerOptions); return handle.model.doGenerate(options); },
    });
    const providerOptions = { openai: { promptCacheKey: "invoice", reasoningEffort: "low" } };
    for (const options of [providerOptions, undefined]) {
      const result = await createExtractor({
        loaders: [loader()],
        strategies: [strategy({ model, ...(options === undefined ? {} : { providerOptions: options }) })],
      }).extract(new Uint8Array([1]), schema);
      expect(result.data).toEqual({ value: "accepted" });
    }
    expect(received).toEqual([providerOptions, undefined]);
  });

  it("separates answer-changing settings and canonicalizes object key order", async () => {
    const { model, calls } = mockModel([{ value: "low" }, { value: "high" }]);
    const cache = memoryCache();
    const values: string[] = [];
    for (const providerOptions of [
      { openai: { reasoningEffort: "low", nested: { a: 1, b: [2, 3] } } },
      { openai: { nested: { b: [2, 3], a: 1 }, reasoningEffort: "low" } },
      { openai: { reasoningEffort: "high", nested: { a: 1, b: [2, 3] } } },
    ]) {
      const result = await createExtractor({
        loaders: [loader()], strategies: [strategy({ model, cache, providerOptions })],
      }).extract(new Uint8Array([1]), schema);
      values.push(result.data.value);
    }
    expect(values).toEqual(["low", "low", "high"]);
    expect(calls).toHaveLength(2);
  });
});
