import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cacheKey } from "../src/cache.js";

it("preserves persisted cache key digests", () => {
  expect(cacheKey({ modelId: "gpt-4o", system: "sys", prompt: "hello", jsonSchema: { type: "object" }, variant: "strict" })).toBe("2570fee62de11586af1343acb2c439e46b4e5c3ff94df5e205286658a2c58729");
  expect(cacheKey({ modelId: "m", system: "", prompt: "", jsonSchema: {} })).toBe("4cb3bed74ffa36c72ab72c8a5d85e97cda03011c8ccbc9ef457b7234e4450b51");
});

it("keeps cache source free of literal NUL bytes", () => {
  expect(readFileSync(new URL("../src/cache.ts", import.meta.url)).includes(0)).toBe(false);
});
