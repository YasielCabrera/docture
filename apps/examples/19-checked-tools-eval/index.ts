import assert from "node:assert/strict";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createCheckedExtractor, defineStrategy, DocumentLoaderData } from "docture";
import { extractTool } from "docture/llm/tool";
import { inMemoryDataset, looseEval } from "@docture/eval";
import { calibrationSection } from "@docture/eval/calibration";
import { renderScoreboard } from "@docture/eval/reporters/terminal";
import { runEval } from "@docture/eval/runner";

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

// Four labelled OCR readings of one amount: the value read and the OCR confidence behind it.
const readings = new Map<string, readonly [number, number]>([["a", [10, 0.9]], ["b", [99, 0.9]], ["c", [10, 0.8]], ["d", [10, 0.7]]]);
const result = await runEval({
  dataset: inMemoryDataset("labelled-ocr", [...readings.keys()].map((id) => ({ id, documents: [], expected: { amount: 10 } }))),
  spec: looseEval(),
  experiments: {
    id: "ocr",
    async extract(item) {
      const [amount, confidence] = readings.get(item.id) ?? [0, 0];
      return { raw: { amount }, confidence: { amount: confidence } };
    },
  },
  sections: [calibrationSection({ targetPrecision: 0.75, minSupport: 2 })],
});
const overall = result.calibration?.experiments["ocr"]?.overall;
assert.equal(overall?.support, 4);
assert.deepEqual(overall?.scores, [{ confidence: 0.9, count: 2, correct: 1 }, { confidence: 0.8, count: 1, correct: 1 }, { confidence: 0.7, count: 1, correct: 1 }]);
console.log(renderScoreboard(result));
