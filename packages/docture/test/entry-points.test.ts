import { expect, it } from "vitest";
import * as core from "docture";
import * as cache from "docture/llm/cache";
import * as text from "docture/llm/text";
import { llm, LlmStrategy } from "docture/llm";

it("keeps model implementations outside the core entry", () => {
  expect("LLM" in core).toBe(false);
  expect(core.CompletionStrategy.PAGINATE).toBe("paginate");
});

it("exposes text extraction without widening the narrow entry", () => {
  expect(Object.keys(text).sort()).toEqual(["LlmStrategy", "llm", "modelIdOf"]);
  expect(text.llm).toBe(llm);
  expect(text.LlmStrategy).toBe(LlmStrategy);
});

it("exports cache utilities without the internal usage-storage helper", async () => {
  expect(Object.keys(cache).sort()).toEqual(["cacheKey", "fileCache", "fingerprint", "memoryCache"]);
  const responses = cache.memoryCache();
  await responses.set("invoice", { data: { total: 17 }, usage: {} });
  expect(await responses.get("invoice")).toEqual({ data: { total: 17 }, usage: {} });
});
