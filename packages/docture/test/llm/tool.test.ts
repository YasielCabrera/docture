import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, Extractor } from "docture";
import { extractTool } from "../../src/llm/tool.js";

it("an AI SDK tool call uses the caller's extractor and source policy without taking ownership", async () => {
  const extractor = new Extractor({ loaders: [new DocumentLoaderData()], strategies: [{ name: "read", async extract(ctx) { return { data: { text: ctx.document.text } }; } }] });
  const dispose = vi.spyOn(extractor, "dispose");
  const resolve = vi.fn(async (source: string) => {
    if (source !== "allowed.txt") throw new Error("source denied");
    return { bytes: new TextEncoder().encode("Tool extracted text"), mimeType: "text/plain" };
  });
  const tools = { extract: extractTool({ extractor, contract: z.object({ text: z.string() }), resolveSource: resolve }) };
  const model = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "tool-call", toolCallId: "extract-1", toolName: "extract", input: '{"source":"allowed.txt"}' }],
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
  }) });
  const response = await generateText({ model, prompt: "Read allowed.txt", tools });
  expect(response.toolResults[0]?.output).toMatchObject({ ok: true, result: { data: { text: "Tool extracted text" } } });
  expect(resolve).toHaveBeenCalledOnce();
  expect(dispose).not.toHaveBeenCalled();
  await extractor.dispose();
});

it("tool failures and cancellation are serializable and propagate the execution signal", async () => {
  const extractor = new Extractor();
  const controller = new AbortController();
  const resolve = vi.fn(async (_source: string, signal?: AbortSignal) => {
    expect(signal).toBe(controller.signal);
    signal?.throwIfAborted();
    throw new Error("source denied");
  });
  const tool = extractTool({ extractor, contract: z.object({ text: z.string() }), resolveSource: resolve });
  const options = { context: undefined, toolCallId: "call", messages: [], abortSignal: controller.signal };
  const failure = await tool.execute?.({ source: "denied.txt" }, options);
  expect(JSON.parse(JSON.stringify(failure))).toEqual({ ok: false, error: { code: "EXTRACTION_FAILED", message: "source denied" } });
  controller.abort(new Error("cancelled"));
  const cancelled = await tool.execute?.({ source: "allowed.txt" }, options);
  expect(cancelled).toEqual({ ok: false, error: { code: "CANCELLED", message: "cancelled" } });
});
