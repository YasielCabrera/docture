import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";
import { runExample } from "./tool.js";

function caller(source: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "tool-call", toolCallId: "read-invoice", toolName: "extract", input: JSON.stringify({ source }) }],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

it("lets a provider tool call extract the authorized PDF", async () => {
  const result = await runExample(caller("invoice.pdf"));
  expect(result.toolResults[0]?.output).toMatchObject({
    ok: true,
    result: { data: { invoiceNumber: "INV-2026-0142", total: 717.3 } },
  });
});

it("rejects a provider tool call for an unauthorized source", async () => {
  const result = await runExample(caller("../../private.pdf"));
  expect(result.toolResults[0]?.output).toMatchObject({
    ok: false,
    error: { message: "Only invoice.pdf is authorized." },
  });
});
