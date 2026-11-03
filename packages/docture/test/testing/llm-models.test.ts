import { describe, expect, it } from "vitest";
import { createDocumentConverter, type DocumentElement, type LoadedDocument } from "docture";
import { llmLayout } from "docture/llm/layout";
import { inMemoryLoader } from "docture/testing/doubles";
import { mockLayoutModel, type LayoutModelPage } from "docture/testing/llm";

function paragraph(id: string, text: string, y: number): DocumentElement {
  return { id, kind: "paragraph", text, runs: [{ text }], provenance: { pageNumber: 1, box: { x: 50, y, width: 200, height: 12 }, sourceIds: [id] } };
}

const report: LoadedDocument = {
  pages: [{
    pageNumber: 1,
    width: 595,
    height: 842,
    text: "Revenue grew in every region.\nResults",
    layout: [paragraph("body", "Revenue grew in every region.", 100), paragraph("title", "Results", 300)],
  }],
  text: "Revenue grew in every region.\nResults",
  form: "digital",
  loader: "in-memory",
};

describe("mockLayoutModel", () => {
  it("retypes and reorders elements through llmLayout with the given annotations", async () => {
    const converter = createDocumentConverter({
      loaders: [inMemoryLoader(report)],
      layoutAnalyzer: llmLayout({
        model: mockLayoutModel([
          { id: "title", role: "heading", level: 2, order: 0 },
          { id: "body", order: 1 },
        ]),
      }),
    });

    const result = await converter.convert({ bytes: new Uint8Array([1]) });

    expect(result.method).toBe("deterministic+llm-layout");
    expect(result.content).toBe("<!-- page: 1 -->\n\n## Results\n\nRevenue grew in every region.");
  });

  it("chooses annotations from the elements the analyzer describes", async () => {
    const seen: (readonly LayoutModelPage[])[] = [];
    const converter = createDocumentConverter({
      loaders: [inMemoryLoader(report)],
      layoutAnalyzer: llmLayout({
        model: mockLayoutModel((pages) => {
          seen.push(pages);
          return pages.flatMap((page) => page.elements.map((element) => element.content === "Results"
            ? { id: element.id, role: "heading" as const, level: 1 as const, order: 0 }
            : { id: element.id, order: 1 }));
        }),
      }),
    });

    const result = await converter.convert({ bytes: new Uint8Array([1]) });

    expect(result.content).toBe("<!-- page: 1 -->\n\n# Results\n\nRevenue grew in every region.");
    expect(seen).toEqual([[{
      pageNumber: 1,
      elements: [
        { id: "body", role: "paragraph", box: { x: 50, y: 100, width: 200, height: 12 }, content: "Revenue grew in every region." },
        { id: "title", role: "paragraph", box: { x: 50, y: 300, width: 200, height: 12 }, content: "Results" },
      ],
    }]]);
  });

  it("reports the configured token usage so cost accounting can be tested", async () => {
    const converter = createDocumentConverter({
      loaders: [inMemoryLoader(report)],
      layoutAnalyzer: llmLayout({
        model: mockLayoutModel([], { modelId: "priced", usage: { inputTokens: 1_000, outputTokens: 500 } }),
        pricing: { priced: { inputPerMillion: 2, outputPerMillion: 4 } },
      }),
    });

    const result = await converter.convert({ bytes: new Uint8Array([1]) });

    expect(result.usage).toMatchObject({ inputTokens: 1_000, outputTokens: 500, costUsd: 0.004 });
  });
});
