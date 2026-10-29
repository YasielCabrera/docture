import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { defineModel, gen, SynthesisError } from "../src/index.js";
import { llmTextPool } from "../src/llm/index.js";
import { Invoice, invoiceFields, withTotals } from "./fixtures.js";

const replying = (text: string): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    modelId: "mock-writer",
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    }),
  });

const NAMES = '{"values":["Schreinerei Holzwurm"," Malerbetrieb Farbenfroh ","Schreinerei Holzwurm","Elektro Funke KG"]}';

describe("llmTextPool", () => {
  it("asks once for a structured list at temperature 0, then trims and dedups it", async () => {
    const model = replying(NAMES);
    const pool = await llmTextPool({ model, prompt: "German company names of small trades", count: 4 });
    expect(pool).toEqual(["Schreinerei Holzwurm", "Malerbetrieb Farbenfroh", "Elektro Funke KG"]);
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call?.temperature).toBe(0);
    expect(call?.responseFormat).toEqual({
      type: "json",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["values"],
        properties: { values: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 } },
      },
    });
    expect(call?.prompt.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: '{"count":4,"values":"German company names of small trades"}' }] });
  });

  it("serves a cached pool without calling the model, keyed by model, prompt and count", async () => {
    const store = new Map<string, readonly string[]>();
    const first = replying(NAMES);
    const pool = await llmTextPool({ model: first, prompt: "trades", count: 4, cache: store });
    const offline = replying("not json");
    expect(await llmTextPool({ model: offline, prompt: "trades", count: 4, cache: store })).toEqual(pool);
    expect(offline.doGenerateCalls).toHaveLength(0);
    expect([...store.keys()]).toEqual(['{"model":"mock-provider/mock-writer","prompt":"trades","count":4,"temperature":0}']);
    await llmTextPool({ model: replying(NAMES), prompt: "trades", count: 3, cache: store });
    expect(store.size).toBe(2);
  });

  it("feeds a model through gen.pick, so ground truth is the sampled pool value", async () => {
    const pool = await llmTextPool({ model: replying(NAMES), prompt: "trades", count: 4 });
    const model = defineModel(Invoice, { fields: { ...invoiceFields, "seller.name": gen.pick(pool) }, derive: withTotals });
    const names = await Promise.all([1, 2, 3, 4, 5, 6].map(async (seed) => (await model.sample({ seed })).value.seller.name));
    expect(names).toEqual(["Malerbetrieb Farbenfroh", "Malerbetrieb Farbenfroh", "Elektro Funke KG", "Schreinerei Holzwurm", "Malerbetrieb Farbenfroh", "Malerbetrieb Farbenfroh"]);
  });

  it("rejects a reply that is not a list of strings, and one with no usable strings", async () => {
    await expect(llmTextPool({ model: replying('{"values":[1,2]}'), prompt: "trades", count: 2 })).rejects.toThrow("No object generated");
    const error = await llmTextPool({ model: replying('{"values":["  ",""]}'), prompt: "trades", count: 2 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SynthesisError);
    expect((error as SynthesisError).problems).toEqual([{ path: "llmTextPool", message: 'mock-provider/mock-writer returned no usable strings for "trades"' }]);
  });
});
