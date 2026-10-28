import assert from "node:assert/strict";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createCheckedExtractor, defineStrategy, DocumentLoaderData } from "docture";
import { extractTool } from "docture/llm/tool";
import { calibrateFields, formatCalibration, type CalibrationSample } from "docture/eval";

const text = "The caller authorized this text source for extraction through a checked pipeline.";
const extractor = createCheckedExtractor({
  loaders: [new DocumentLoaderData()],
  strategies: [defineStrategy({ name: "read-text", requires: ["TEXT_LAYER"], async extract(context) { return { data: { text: context.document.text } }; } })],
});
try {
  const tools = { extract: extractTool({
    extractor,
    contract: z.object({ text: z.string() }),
    async resolveSource(source, signal) {
      signal?.throwIfAborted();
      if (source !== "allowed.txt") throw new Error("Source denied by the caller");
      return { bytes: new TextEncoder().encode(text), mimeType: "text/plain" };
    },
  }) };
  const model = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "tool-call", toolCallId: "read-1", toolName: "extract", input: '{"source":"allowed.txt"}' }],
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
  }) });
  const response = await generateText({ model, prompt: "Read the allowed source", tools });
  const output = z.object({ ok: z.literal(true), result: z.object({ data: z.object({ text: z.string() }) }) }).parse(response.toolResults[0]?.output);
  assert.equal(output.result.data.text, text);
  console.log("Checked extractor and caller-owned AI SDK tool: expected text extracted.");
} finally {
  await extractor.dispose();
}

const sample = (document: string, actual: number, confidence: number): CalibrationSample => ({
  document, expected: { amount: 10 }, result: { data: { amount: actual }, citations: [{ path: "amount", status: "verified", ids: ["p1-line-1"], minOcrConfidence: confidence }] },
});
const report = calibrateFields([sample("a", 10, .9), sample("b", 99, .9), sample("c", 10, .8), sample("d", 10, .7)], {
  targetPrecision: .75, minSupport: 2, context: { corpus: "synthetic labelled demonstration" },
});
assert.equal(report.fields[0]?.threshold, .7);
console.log(formatCalibration(report));
