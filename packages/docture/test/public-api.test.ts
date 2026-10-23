import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, Extractor, Process, contract } from "docture";
import { LLM, TextSplitter } from "docture/llm";
import { MockLanguageModelV4 } from "ai/test";

describe("end to end through public entry points", () => {
  const model = new MockLanguageModelV4({
    modelId: "mock",
    provider: "mock",
    async doGenerate() {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ invoiceNumber: "INV-7" }) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  const Invoice = contract({
    name: "invoice",
    description: "A commercial invoice.",
    schema: z.object({ invoiceNumber: z.string() }),
  });

  it("extracts a document using the core and LLM entries", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(model));

    const result = await extractor.extract(
      {
        bytes: new TextEncoder().encode(
          "INVOICE INV-7, issued to somebody, with well over fifty characters of text.",
        ),
        mimeType: "text/plain",
      },
      Invoice,
    );

    expect(result.data.invoiceNumber).toBe("INV-7");
    expect(result.usage.inputTokens).toBe(120);
  });

  it("wires a Process the same way", () => {
    const process = new Process()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadSplitter(new TextSplitter({ model }))
      .loadExtractor(new Extractor().loadDocumentLoader(new DocumentLoaderData()));

    expect(process).toBeInstanceOf(Process);
  });
});
