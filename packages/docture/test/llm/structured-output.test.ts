import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, ExtractionFailedError } from "docture";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

describe("structured model output", () => {
  it("uses the current structured text API in every capability", async () => {
    const deprecated = "generate" + "Object";
    const files = ["strategy", "vision", "classifier", "layout", "split"];
    const stale: string[] = [];
    for (const file of files) {
      const source = await readFile(new URL(`../../src/llm/${file}.ts`, import.meta.url), "utf8");
      if (source.includes(deprecated)) stale.push(file);
    }
    expect(stale).toEqual([]);
  });

  it("retains failed schema accounting and the model error code", async () => {
    const { model, calls } = mockModel([{ value: 123 }]);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument(["Invoice INV-42 with total 12.00 EUR and a complete text layer."]))],
      strategies: [llm({ model })],
      maxRepairs: 0,
    });
    const outcome = await extractor.safeExtract(new Uint8Array([1]), z.object({ value: z.string() }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expected invalid model output");
    expect(outcome.error).toBeInstanceOf(ExtractionFailedError);
    if (!(outcome.error instanceof ExtractionFailedError)) throw outcome.error;
    expect(outcome.error.code).toBe("EXTRACTION_FAILED");
    expect(outcome.error.attempts).toEqual([
      expect.objectContaining({
        strategy: "llm", status: "failed", errorCode: "MODEL_OUTPUT_FAILED",
        usage: expect.objectContaining({ inputTokens: 100, outputTokens: 25, totalTokens: 125 }),
      }),
    ]);
    expect(calls).toHaveLength(1);
  });
});
