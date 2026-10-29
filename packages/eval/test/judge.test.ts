import { expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { defineEval } from "../src/index.js";
import { judge } from "../src/judge/index.js";

it("judge requests a deterministic structured verdict and reuses its cached answer", async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "text", text: '{"match":true,"similarity":1,"reason":"Equivalent meaning"}' }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
  }) });
  const comparator = judge({ model, rubric: "Accept equivalent meanings" });
  const context = { path: "name", pattern: "name" };
  const verdict = { match: true, similarity: 1, note: "Equivalent meaning" };
  expect(await comparator.compare("Hello", "Hi", context)).toEqual(verdict);
  expect(await comparator.compare("Hello", "Hi", context)).toEqual(verdict);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(model.doGenerateCalls[0]).toMatchObject({ temperature: 0, responseFormat: { type: "json" } });
  expect(await comparator.compare("Hello", 42, context)).toMatchObject({ match: false, similarity: 0 });
});

it("judge caches by rubric, model, values and path through an injectable store", async () => {
  const keys: string[] = [];
  const model = new MockLanguageModelV4();
  const cache = { get(key: string) { keys.push(key); return { match: true, similarity: 1 }; }, set() { throw new Error("Cached verdict must not be overwritten"); } };
  const one = judge({ model, rubric: "one", cache });
  await one.compare("a", "b", { path: "x", pattern: "x" });
  await one.compare("a", "b", { path: "x", pattern: "x" });
  await judge({ model, rubric: "two", cache }).compare("a", "b", { path: "x", pattern: "x" });
  await one.compare("a", "c", { path: "x", pattern: "x" });
  await one.compare("a", "b", { path: "y", pattern: "y" });
  expect(keys[0]).toBe(keys[1]);
  expect(new Set(keys)).toHaveProperty("size", 4);
  expect(model.doGenerateCalls).toHaveLength(0);
});

it("judge rejects an aborted comparison before reading a cached verdict", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const comparator = judge({ model: new MockLanguageModelV4(), rubric: "equal" });
  await expect(comparator.compare("a", "b", { path: "x", pattern: "x", signal: controller.signal })).rejects.toThrow("cancelled");
});

const replying = (text: string) => new MockLanguageModelV4({ doGenerate: async () => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
}) });

it("judge grades string leaves inside a spec through scoreAsync and refuses synchronous scoring", async () => {
  const schema = { type: "object", properties: { name: { type: "string" }, total: { type: "number" } }, required: ["name", "total"], additionalProperties: false } as const;
  const spec = defineEval(schema, { strings: judge({ model: replying('{"match":true,"similarity":0.9,"reason":"Same person"}'), rubric: "Same person" }) });
  const score = await spec.scoreAsync({ name: "Ada Lovelace", total: 42 }, { name: "A. Lovelace", total: 41 });
  expect(score.counts).toEqual({ match: 1, mismatch: 1, omission: 0, hallucination: 0 });
  expect(score.fields.find((field) => field.path === "name")).toMatchObject({ status: "match", similarity: 0.9, comparator: "judge" });
  expect(() => spec.score({ name: "Ada Lovelace", total: 42 }, { name: "A. Lovelace", total: 42 })).toThrow("call spec.scoreAsync instead");
});

it("judge rejects a verdict outside its schema instead of scoring it", async () => {
  const comparator = judge({ model: replying('{"match":true,"similarity":1.5,"reason":"very"}'), rubric: "equal" });
  await expect(comparator.compare("a", "b", { path: "x", pattern: "x" })).rejects.toThrow("No object generated");
});
