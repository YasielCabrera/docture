import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { createExtractor, withRasterizer, type ExtractionResult, type Rasterizer } from "docture";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { memoryCache } from "docture/llm/cache";
import { fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel, type MockCall } from "./mock-model.js";

const Value = z.object({ value: z.string() });
const Totals = z.object({ total: z.number() });
const bytes = new Uint8Array([1]);
const text = "Invoice INV-42 value ok, total 70.00 EUR. This document has a complete text layer.";
const loader = (pages: readonly string[] = [text]) => inMemoryLoader(loadedDocument(pages));

function promptText(call: MockCall | undefined): string {
  const messages = (call?.prompt ?? []) as { role: string; content: unknown }[];
  return messages.map((message) => typeof message.content === "string"
    ? message.content
    : (message.content as { type: string; text?: string }[])
      .map((part) => part.type === "text" ? part.text ?? "" : `[${part.type}]`).join("\n")).join("\n");
}

function stagesOf(result: ExtractionResult<unknown>) {
  return result.attempts.map((attempt) => [attempt.stage, attempt.strategy, attempt.status]);
}

function stubRasterizer(): Rasterizer {
  return {
    name: "stub-raster",
    formats: ["png"],
    async rasterize(_document, options) {
      return (options.pages ?? [1]).map((pageNumber) => ({
        pageNumber, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), widthPx: 10, heightPx: 14,
        format: "png" as const, scale: 1,
      }));
    },
  };
}

describe("validation repair", () => {
  it("re-asks the model once with its previous output and the issues", async () => {
    const { model, calls } = mockModel([{ value: 123 }, { value: "ok" }]);
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [llm({ model })],
    }).extract(bytes, Value);

    expect(result.data).toEqual({ value: "ok" });
    expect(calls).toHaveLength(2);
    expect(stagesOf(result)).toEqual([["extract", "llm", "failed"], ["repair", "llm", "ok"]]);
    expect(result.attempts[0]?.errorCode).toBe("MODEL_OUTPUT_FAILED");
    expect(result.usage.totalTokens).toBe(250);
    expect(result.attempts.map((attempt) => attempt.usage?.totalTokens)).toEqual([125, 125]);
    const repairPrompt = promptText(calls[1]);
    expect(repairPrompt).toContain('{"value":123}');
    expect(repairPrompt).toContain("value: Invalid input: expected string, received number");
    expect(repairPrompt).toContain(text);
  });

  it("stops after maxRepairs and falls through to the next strategy", async () => {
    const { model, calls } = mockModel([{ value: 123 }]);
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [llm({ model }), fixedStrategy("fallback", { value: "fallback" })],
      maxRepairs: 1,
    }).extract(bytes, Value);

    expect(calls).toHaveLength(2);
    expect(result.method).toBe("fallback");
    expect(stagesOf(result)).toEqual([
      ["extract", "llm", "failed"], ["repair", "llm", "failed"], ["extract", "fallback", "ok"],
    ]);
    expect(result.usage.totalTokens).toBe(250);
  });

  it("makes exactly today's single call with maxRepairs 0", async () => {
    const { model, calls } = mockModel([{ value: 123 }, { value: "ok" }]);
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [llm({ model }), fixedStrategy("fallback", { value: "fallback" })],
    }).extract(bytes, Value, { maxRepairs: 0 });

    expect(calls).toHaveLength(1);
    expect(stagesOf(result)).toEqual([["extract", "llm", "failed"], ["extract", "fallback", "ok"]]);
  });

  it("allows several repairs when asked", async () => {
    const { model, calls } = mockModel([{ value: 1 }, { value: 2 }, { value: "third" }]);
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model })] })
      .extract(bytes, Value, { maxRepairs: 2 });

    expect(calls).toHaveLength(3);
    expect(result.data).toEqual({ value: "third" });
    expect(result.usage.totalTokens).toBe(375);
  });

  it("rejects a repair budget that is not a non-negative integer", async () => {
    const run = createExtractor({ loaders: [loader()], strategies: [fixedStrategy("f", { value: "x" })] })
      .extract(bytes, Value, { maxRepairs: -1 });
    await expect(run).rejects.toThrow(RangeError);
  });

  it("rejects an extractor-level repair budget when the extractor is built", () => {
    for (const maxRepairs of [1.5, -1, Number.NaN]) {
      expect(() => createExtractor({ loaders: [loader()], strategies: [fixedStrategy("f", { value: "x" })], maxRepairs }))
        .toThrow(new RangeError("maxRepairs must be a non-negative integer"));
    }
  });

  it("repairs a fail-mode rule issue with the rule's message", async () => {
    const { model, calls } = mockModel([{ total: 60 }, { total: 70 }]);
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model })] })
      .extract(bytes, Totals, {
        onRuleFailure: "fail",
        rules: [(data) => data.total === 70 ? [] : [{ path: "total", message: "Sum mismatch" }]],
      });

    expect(result.data).toEqual({ total: 70 });
    expect(result.validation).toEqual({ valid: true, issues: [] });
    expect(stagesOf(result)).toEqual([["extract", "llm", "failed"], ["repair", "llm", "ok"]]);
    expect(result.attempts[0]?.errorCode).toBe("CONTRACT_VIOLATION");
    expect(promptText(calls[1])).toContain("total: Sum mismatch");
    expect(promptText(calls[1])).toContain('{"total":60}');
  });

  it("does not repair report-mode rule issues", async () => {
    const { model, calls } = mockModel([{ total: 60 }, { total: 70 }]);
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model })] })
      .extract(bytes, Totals, { rules: [() => [{ path: "total", message: "Sum mismatch" }]] });

    expect(calls).toHaveLength(1);
    expect(result.data).toEqual({ total: 60 });
    expect(result.validation).toEqual({ valid: false, issues: [{ path: "total", message: "Sum mismatch" }] });
  });

  it("repairs a merged chunked answer without resending the document", async () => {
    const Both = z.object({ first: z.string(), second: z.string() });
    const { model, calls } = mockModel([{ first: "a" }, { first: "a" }, { first: "a", second: "b" }]);
    const result = await createExtractor({
      loaders: [loader(["Page one has the first field and plenty of text.", "Page two has the second field."])],
      strategies: [llm({ model, completion: "paginate", concurrency: 1 })],
    }).extract(bytes, Both);

    expect(calls).toHaveLength(3);
    expect(result.data).toEqual({ first: "a", second: "b" });
    expect(stagesOf(result)).toEqual([["extract", "llm", "failed"], ["repair", "llm", "ok"]]);
    expect(result.attempts[0]?.errorCode).toBe("CONTRACT_VIOLATION");
    const repairPrompt = promptText(calls[2]);
    expect(repairPrompt).toContain('{"first":"a"}');
    expect(repairPrompt).toContain("second:");
    expect(repairPrompt).not.toContain("Page two has the second field.");
  });

  it("repairs a cached answer that fails a rule and caches the repair", async () => {
    const cache = memoryCache();
    const rules = [(data: { total: number }) => data.total === 70 ? [] : [{ path: "total", message: "Sum mismatch" }]];
    const first = mockModel([{ total: 60 }, { total: 70 }]);
    await createExtractor({ loaders: [loader()], strategies: [llm({ model: first.model, cache })] })
      .extract(bytes, Totals, { onRuleFailure: "fail", rules });
    const second = mockModel([{ total: 1 }]);
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model: second.model, cache })] })
      .extract(bytes, Totals, { onRuleFailure: "fail", rules });

    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(0);
    expect(result.data).toEqual({ total: 70 });
    expect(stagesOf(result)).toEqual([["extract", "llm", "failed"], ["repair", "llm", "ok"]]);
  });

  it("repairs from the complete model output while the attempt keeps the truncated copy", async () => {
    const padding = "x".repeat(12_000);
    const { model, calls } = mockModel([{ value: 123, padding }, { value: "ok" }]);
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model })] })
      .extract(bytes, z.object({ value: z.string(), padding: z.string().optional() }));

    expect(result.data).toEqual({ value: "ok" });
    expect(result.attempts[0]?.rawOutput).toHaveLength(10_000);
    expect(promptText(calls[1])).toContain(`"padding":"${padding}"}`);
  });

  it("records a timed-out repair and falls through", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      modelId: "slow", provider: "mock",
      async doGenerate(options) {
        call += 1;
        if (call > 1) {
          await new Promise((_resolve, reject) => {
            options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason), { once: true });
          });
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ value: 123 }) }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 25, text: 25, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [llm({ model, maxRetries: 0 }), fixedStrategy("fallback", { value: "fallback" })],
      stageTimeoutMs: 50,
    }).extract(bytes, Value);

    expect(result.method).toBe("fallback");
    expect(stagesOf(result)).toEqual([
      ["extract", "llm", "failed"], ["repair", "llm", "failed"], ["extract", "fallback", "ok"],
    ]);
    expect(result.attempts[1]?.errorCode).toBe("TIMEOUT");
  });

  it("stops without fallback when the caller cancels during a repair", async () => {
    const controller = new AbortController();
    let call = 0;
    const model = new MockLanguageModelV4({
      modelId: "cancel", provider: "mock",
      async doGenerate() {
        call += 1;
        if (call > 1) controller.abort(new DOMException("caller stopped", "AbortError"));
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ value: 123 }) }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });
    let fallbackRan = false;
    const run = createExtractor({
      loaders: [loader()],
      strategies: [
        llm({ model, maxRetries: 0 }),
        { name: "fallback", async extract() { fallbackRan = true; return { data: { value: "x" } }; } },
      ],
    }).extract(bytes, Value, { signal: controller.signal });

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(call).toBe(2);
    expect(fallbackRan).toBe(false);
  });

  it("resends the page image when repairing a single vision request", async () => {
    const { model, calls } = mockModel([{ value: 123 }, { value: "ok" }]);
    const result = await createExtractor({
      loaders: [withRasterizer(loader(["Scanned page"]), stubRasterizer())],
      strategies: [vision({ model })],
    }).extract(bytes, Value);

    expect(result.data).toEqual({ value: "ok" });
    expect(stagesOf(result)).toEqual([["extract", "vision", "failed"], ["repair", "vision", "ok"]]);
    expect(promptText(calls[1])).toContain("[file]");
    expect(promptText(calls[1])).toContain('{"value":123}');
  });
});
