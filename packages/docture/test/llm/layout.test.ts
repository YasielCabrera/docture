import { describe, expect, it } from "vitest";
import { silentLogger, type LayoutAnalyzerContext, type LayoutDocument } from "docture";
import { LLM, LlmLayoutAnalyzer, llmLayout, memoryCache } from "../../src/llm/index.js";
import { failingModel, mockModel } from "./mock-model.js";

function context(): LayoutAnalyzerContext {
  const document: LayoutDocument = {
    pages: [
      {
        pageNumber: 1,
        width: 600,
        height: 800,
        elements: [
          {
            id: "title",
            kind: "paragraph",
            text: "Grounded title",
            runs: [{ text: "Grounded title" }],
            provenance: {
              pageNumber: 1,
              box: { x: 20, y: 20, width: 140, height: 20 },
              sourceIds: ["source-title"],
            },
          },
          {
            id: "body",
            kind: "paragraph",
            text: "Exact source text",
            runs: [{ text: "Exact source text" }],
            provenance: {
              pageNumber: 1,
              box: { x: 20, y: 60, width: 180, height: 12 },
              sourceIds: ["source-body"],
            },
          },
        ],
      },
    ],
  };
  return {
    document,
    signal: new AbortController().signal,
    logger: silentLogger,
  };
}

describe("LlmLayoutAnalyzer", () => {
  it("returns only constrained id, role, level, and order annotations", async () => {
    const handle = mockModel(
      [
        {
          annotations: [
            { id: "title", role: "heading", level: 1, order: 0 },
            { id: "body", role: "paragraph", order: 1 },
          ],
        },
      ],
      { inputTokens: 12, outputTokens: 4 },
    );
    const result = await llmLayout({ model: handle.model }).analyze(context());
    expect(result.annotations).toEqual([
      { id: "title", role: "heading", level: 1, order: 0 },
      { id: "body", role: "paragraph", order: 1 },
    ]);
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 4, totalTokens: 16 });
    expect(JSON.stringify(handle.calls[0]?.prompt)).toContain("Exact source text");
  });

  it("rejects responses that try to introduce a text field", async () => {
    const handle = mockModel([
      {
        annotations: [
          { id: "title", role: "heading", order: 0, text: "Invented replacement" },
          { id: "body", role: "paragraph", order: 1 },
        ],
      },
    ]);
    await expect(new LlmLayoutAnalyzer({ model: handle.model, maxRetries: 0 }).analyze(context()))
      .rejects.toThrow();
  });

  it("caches valid analysis and retains usage totals", async () => {
    const handle = mockModel([
      {
        annotations: [
          { id: "title", role: "heading", order: 0 },
          { id: "body", role: "paragraph", order: 1 },
        ],
      },
    ]);
    const analyzer = llmLayout({ model: handle.model, cache: memoryCache() });
    const first = await analyzer.analyze(context());
    const second = await analyzer.analyze(context());
    expect(handle.calls).toHaveLength(1);
    expect(second.annotations).toEqual(first.annotations);
    expect(second.usage?.totalTokens).toBe(first.usage?.totalTokens);
  });

  it("surfaces provider failures for core to fall back from", async () => {
    await expect(llmLayout({ model: failingModel(), maxRetries: 0 }).analyze(context()))
      .rejects.toThrow("provider exploded");
  });

  it("is available through LLM.layout()", () => {
    const handle = mockModel([{ annotations: [] }]);
    expect(new LLM(handle.model).layout()).toBeInstanceOf(LlmLayoutAnalyzer);
  });
});
