import { jsonSchema } from "ai";
import { expect, it } from "vitest";
import { createExtractor } from "docture";
import { memoryCache } from "docture/llm/cache";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

it("keeps cached extraction answers independent of returned data mutations", async () => {
  const { model, calls } = mockModel([{ total: 10 }]);
  const extractor = createExtractor({
    loaders: [inMemoryLoader(loadedDocument(["Invoice INV-1 for widgets, total due 10.00 EUR, thank you."]))],
    strategies: [llm({ model, cache: memoryCache() })],
  });
  const schema = jsonSchema<{ total: number }>({
    type: "object", properties: { total: { type: "number" } },
  });
  const first = await extractor.extract(new Uint8Array([1]), schema);
  first.data.total = -1;
  const second = await extractor.extract(new Uint8Array([1]), schema);
  expect(second.data).toEqual({ total: 10 });
  second.data.total = -2;
  const third = await extractor.extract(new Uint8Array([1]), schema);
  expect(third.data).toEqual({ total: 10 });
  expect(calls).toHaveLength(1);
});

it("copies nested data and usage on cache writes", async () => {
  const cache = memoryCache();
  const row = { total: 10 };
  const original = { data: { rows: [row] }, usage: { inputTokens: 12, inputTokenDetails: { cacheReadTokens: 3 } } };
  await cache.set("invoice", original);
  row.total = -1;
  original.usage.inputTokenDetails.cacheReadTokens = -1;
  const first = await cache.get("invoice");
  expect(first).toEqual({ data: { rows: [{ total: 10 }] }, usage: { inputTokens: 12, inputTokenDetails: { cacheReadTokens: 3 } } });
});
