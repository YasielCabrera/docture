import { describe, expect, it } from "vitest";
import * as docture from "../../src/index.js";
import {
  DocumentConverter,
  applyLayoutAnnotations,
  type DocumentElement,
  type LayoutAnnotation,
  type LayoutDocument,
  type LoadedSource,
} from "../../src/index.js";

function paragraph(pageNumber: number, id: string, text: string): DocumentElement {
  return {
    kind: "paragraph",
    id,
    text,
    runs: [{ text }],
    provenance: { pageNumber, box: { x: 30, y: 100, width: 500, height: 15 }, sourceIds: [] },
  };
}

function header(pageNumber: number, id: string): DocumentElement {
  return {
    kind: "page-header",
    id,
    text: "Running header",
    runs: [{ text: "Running header" }],
    evidence: "tagged",
    provenance: { pageNumber, box: { x: 30, y: 20, width: 500, height: 10 }, sourceIds: [] },
  };
}

function threePages(): LoadedSource {
  const pages = [1, 2, 3].map((pageNumber) => ({
    pageNumber,
    width: 600,
    height: 800,
    text: `Page ${pageNumber} original paragraph.`,
    layout: [paragraph(pageNumber, `p${pageNumber}-text`, `Page ${pageNumber} original paragraph.`)],
  }));
  return {
    loaded: { pages, text: pages.map((page) => page.text).join("\f"), form: "digital", loader: "synthetic-loaded-source" },
    mimeType: "application/pdf",
    fileName: "three-pages.pdf",
  };
}

async function convertWithInvalidPage(invalidPage: number | null, options: { attributePages?: boolean } = {}) {
  let calls = 0;
  const converter = new DocumentConverter({
    layoutAnalyzer: {
      name: "per-page-example",
      async analyze({ document }) {
        calls += 1;
        const annotations: LayoutAnnotation[] = [];
        for (const page of document.pages) {
          annotations.push(...page.elements.filter((element) => element.kind === "paragraph").map((element) => ({
            id: page.pageNumber === invalidPage ? "unknown-element-id" : element.id,
            role: "heading" as const,
            level: 2 as const,
            ...(options.attributePages === true ? { pageNumber: page.pageNumber } : {}),
          })));
        }
        return { annotations, usage: { inputTokens: 300, outputTokens: 30, totalTokens: 330 } };
      },
    },
  });
  try {
    const result = await converter.convert(threePages(), { format: "markdown", assets: "omit" });
    return { ...result, calls };
  } finally {
    await converter.dispose();
  }
}

function layout(pages: readonly (readonly DocumentElement[])[]): LayoutDocument {
  return {
    pages: pages.map((elements, index) => ({ pageNumber: index + 1, width: 600, height: 800, elements })),
  };
}

function kinds(document: LayoutDocument): string[][] {
  return document.pages.map((page) => page.elements.map((element) => element.kind));
}

describe("page-local layout annotations", () => {
  it("is a function on the root entry", () => {
    expect(typeof docture.applyLayoutAnnotations).toBe("function");
  });

  it("applies every page when all annotations are valid", async () => {
    const result = await convertWithInvalidPage(null);
    expect(result.content).toBe([
      "<!-- page: 1 -->", "## Page 1 original paragraph.",
      "<!-- page: 2 -->", "## Page 2 original paragraph.",
      "<!-- page: 3 -->", "## Page 3 original paragraph.",
    ].join("\n\n"));
    expect(result.method).toBe("deterministic+per-page-example");
    expect(result.warnings).toEqual([]);
  });

  it("keeps the valid pages when one page names an unknown element", async () => {
    const result = await convertWithInvalidPage(2);
    expect(result.content).toBe([
      "<!-- page: 1 -->", "## Page 1 original paragraph.",
      "<!-- page: 2 -->", "Page 2 original paragraph.",
      "<!-- page: 3 -->", "## Page 3 original paragraph.",
    ].join("\n\n"));
    expect(result.method).toBe("deterministic+per-page-example");
    expect(result.warnings).toEqual([{
      code: "INVALID_LAYOUT_ANALYSIS",
      message: 'Layout analyzer "per-page-example" was ignored for one annotation: unknown element id unknown-element-id.',
    }]);
    expect(result.calls).toBe(1);
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 30, totalTokens: 330 });
    expect(result.attempts.at(-1)).toMatchObject({ stage: "layout", status: "ok", usage: { totalTokens: 330 } });
  });

  it("names the page an analyzer answered for when the annotation carries its page number", async () => {
    const result = await convertWithInvalidPage(2, { attributePages: true });
    expect(result.content).toContain("## Page 1 original paragraph.");
    expect(result.content).toContain("<!-- page: 2 -->\n\nPage 2 original paragraph.");
    expect(result.content).toContain("## Page 3 original paragraph.");
    expect(result.warnings).toEqual([{
      code: "INVALID_LAYOUT_ANALYSIS",
      message: 'Layout analyzer "per-page-example" was ignored on page 2: unknown element id unknown-element-id.',
      pageNumber: 2,
    }]);
  });

  it("keeps the deterministic layout and reports each page when every page is invalid", async () => {
    const converter = new DocumentConverter({
      layoutAnalyzer: {
        name: "deep",
        async analyze({ document }) {
          return {
            annotations: document.pages.flatMap((page) => page.elements.map((element) => ({ id: element.id, role: "heading" as const, level: 9 as 6 }))),
            usage: { totalTokens: 12 },
          };
        },
      },
    });
    const result = await converter.convert(threePages(), { format: "markdown", assets: "omit" });
    expect(result.method).toBe("deterministic");
    expect(result.content).not.toContain("#");
    expect(result.warnings.map((warning) => warning.pageNumber)).toEqual([1, 2, 3]);
    expect(result.warnings[0]).toEqual({
      code: "INVALID_LAYOUT_ANALYSIS",
      message: 'Layout analyzer "deep" was ignored on page 1: heading level 9 for p1-text must be an integer from 1 to 6.',
      pageNumber: 1,
    });
    expect(result.usage.totalTokens).toBe(12);
    expect(result.attempts.at(-1)).toMatchObject({ stage: "layout", status: "failed", usage: { totalTokens: 12 } });
  });

  it("rejects only the page with a repeated id, a partial order or a misplaced element", () => {
    const document = layout([
      [paragraph(1, "a", "A"), paragraph(1, "b", "B")],
      [paragraph(2, "c", "C"), paragraph(2, "d", "D")],
      [paragraph(3, "e", "E"), paragraph(3, "f", "F")],
      [paragraph(4, "g", "G")],
    ]);
    const outcome = applyLayoutAnnotations(document, [
      { id: "a", role: "heading" },
      { id: "a", role: "code" },
      { id: "c", order: 1 },
      { id: "e", role: "heading", pageNumber: 3 },
      { id: "g", role: "heading", pageNumber: 3 },
      { id: "f", role: "heading" },
    ]);
    expect(outcome.rejections).toEqual([
      { pageNumber: 1, reason: "duplicate element id a" },
      { pageNumber: 2, reason: "partial order" },
      { pageNumber: 3, reason: "element g is on page 4" },
    ]);
    expect(outcome.appliedPages).toEqual([]);
    expect(outcome.document.pages).toEqual(document.pages);
  });

  it("applies valid neighbours of a rejected page, including their reading order", () => {
    const document = layout([
      [paragraph(1, "a", "A"), paragraph(1, "b", "B")],
      [paragraph(2, "c", "C"), paragraph(2, "d", "D")],
      [paragraph(3, "e", "E")],
    ]);
    const outcome = applyLayoutAnnotations(document, [
      { id: "a", order: 1 },
      { id: "b", order: 0, role: "heading", level: 1 },
      { id: "c", order: 0 },
      { id: "d", order: 0 },
      { id: "e", role: "code" },
    ]);
    expect(outcome.appliedPages).toEqual([1, 3]);
    expect(outcome.rejections).toEqual([{ pageNumber: 2, reason: "order is not a permutation" }]);
    expect(outcome.document.pages[0]?.elements.map((element) => element.id)).toEqual(["b", "a"]);
    expect(kinds(outcome.document)).toEqual([["heading", "paragraph"], ["paragraph", "paragraph"], ["code"]]);
    expect(outcome.document.pages[1]).toBe(document.pages[1]);
  });

  it("reports an annotation that names no known element or page without rejecting a page", () => {
    const document = layout([[paragraph(1, "a", "A")]]);
    const outcome = applyLayoutAnnotations(document, [
      { id: "a", role: "heading" },
      { id: "invented", role: "heading" },
      { id: "a", pageNumber: 7 },
    ]);
    expect(outcome.appliedPages).toEqual([1]);
    expect(outcome.rejections).toEqual([
      { reason: "unknown element id invented" },
      { reason: "page 7 does not exist for a" },
    ]);
    expect(kinds(outcome.document)).toEqual([["heading"]]);
  });

  it("reports malformed annotations and page numbers without throwing", () => {
    const document = layout([[paragraph(1, "a", "A")]]);
    const untyped = [
      null,
      { id: "a", role: "heading", pageNumber: "1" },
      { id: "a", role: "heading", pageNumber: 1.5 },
    ] as unknown as LayoutAnnotation[];
    const outcome = applyLayoutAnnotations(document, untyped);
    expect(outcome.rejections).toEqual([
      { reason: "annotation 0 has no string id" },
      { reason: "page number 1 for a must be a positive integer" },
      { reason: "page number 1.5 for a must be a positive integer" },
    ]);
    expect(outcome.appliedPages).toEqual([]);
  });

  it("puts furniture back in its slots on every page that is not rejected", () => {
    const document = layout([
      [paragraph(1, "a", "A"), header(1, "h1")],
      [paragraph(2, "b", "B"), header(2, "h2")],
      [paragraph(3, "c", "C"), header(3, "h3")],
    ]);
    const outcome = applyLayoutAnnotations(document, [
      { id: "a", role: "heading" },
      { id: "c", role: "heading", level: 9 as 6 },
    ]);
    expect(outcome.appliedPages).toEqual([1]);
    expect(outcome.rejections).toEqual([{ pageNumber: 3, reason: "heading level 9 for c must be an integer from 1 to 6" }]);
    expect(kinds(outcome.document)).toEqual([["page-header", "heading"], ["page-header", "paragraph"], ["paragraph", "page-header"]]);
  });

  it("summarizes many unknown elements in one converter warning", async () => {
    const converter = new DocumentConverter({
      layoutAnalyzer: {
        name: "inventive",
        async analyze({ document }) {
          const valid = document.pages.map((page) => ({ id: page.elements[0]?.id ?? "", role: "heading" as const }));
          return { annotations: [...valid, ...[1, 2, 3, 4, 5].map((n) => ({ id: `invented-${n}`, role: "heading" as const }))] };
        },
      },
    });
    const result = await converter.convert(threePages(), { format: "markdown", assets: "omit" });
    expect(result.method).toBe("deterministic+inventive");
    expect(result.warnings).toEqual([{
      code: "INVALID_LAYOUT_ANALYSIS",
      message: 'Layout analyzer "inventive" was ignored for 5 annotations: unknown element id invented-1; unknown element id invented-2; unknown element id invented-3; and 2 more.',
    }]);
  });
});
