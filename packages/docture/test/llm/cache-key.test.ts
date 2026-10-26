import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cacheKey } from "../../src/llm/cache.js";

it("pins provider and temperature cache key digests", () => {
  expect(cacheKey({ provider: "openai.chat", modelId: "gpt-4o", temperature: 0, system: "sys", prompt: "hello", jsonSchema: { type: "object" }, variant: "strict" })).toBe("70f64e33825ebe10ea8209db106935cfda93c9dd2a4d09eb21413cedd09f7fa8");
  expect(cacheKey({ provider: "gateway", modelId: "m", temperature: undefined, system: "", prompt: "", jsonSchema: {} })).toBe("f33166c69a5df69bcd57e97256c82368bcf06148a5d3b69de55c89219e71d1e0");
});

it("keeps cache source free of literal NUL bytes", () => {
  expect(readFileSync(new URL("../../src/llm/cache.ts", import.meta.url)).includes(0)).toBe(false);
});
