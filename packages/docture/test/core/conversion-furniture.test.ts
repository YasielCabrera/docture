import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  type DoctureDocument,
  type DocumentElement,
  type LayoutAnalyzerContext,
  type LoadedDocument,
} from "../../src/core/index.js";
import { acmeReport, bookSpread, documentOf, pdfPage, threePages } from "./furniture-fixtures.js";

function summary(elements: readonly DocumentElement[]): string[] {
  return elements.map((element) => {
    switch (element.kind) {
      case "page-header":
      case "page-footer":
        return `${element.kind}:${element.evidence}:${element.text}`;
      case "heading":
      case "paragraph":
      case "code":
        return `${element.kind}:${element.text}`;
      default:
        return element.kind;
    }
  });
}

async function convert(loaded: LoadedDocument, format: "markdown" | "html" | "text" | "json" = "markdown") {
  return new DocumentConverter().convert({ loaded }, { format });
}

describe("running headers and footers", () => {
  it("keeps repeated page furniture out of Markdown and HTML bodies", async () => {
    const markdown = await convert(acmeReport(), "markdown");
    expect(markdown.content).toBe([
      "<!-- page: 1 -->", "Body text of page 1.",
      "<!-- page: 2 -->", "Body text of page 2.",
      "<!-- page: 3 -->", "Body text of page 3.",
    ].join("\n\n"));
    expect(markdown.pages.map((page) => summary(page.elements))).toEqual([1, 2, 3].map((n) => [
      "page-header:repeated:ACME Corp Confidential",
      `paragraph:Body text of page ${n}.`,
      `page-footer:repeated:Page ${n} of 3`,
      ...(n < 3 ? ["page-break"] : []),
    ]));
    const html = await convert(acmeReport(), "html");
    expect(html.content).not.toContain("ACME Corp Confidential");
    expect(html.content).not.toContain("of 3");
    expect(html.pages[1]?.content).toBe(
      '<section id="page-2" data-page-number="2">\n<p>Body text of page 2.</p>\n</section>',
    );
  });

  it("keeps furniture text in TXT and JSON with its source ids and geometry", async () => {
    const text = await convert(acmeReport(), "text");
    expect(text.content).toBe([1, 2, 3]
      .map((n) => `ACME Corp Confidential\n\nBody text of page ${n}.\n\nPage ${n} of 3`)
      .join("\f"));
    const json = await convert(acmeReport(), "json");
    const document = JSON.parse(json.content) as DoctureDocument;
    expect(document.schemaVersion).toBe(2);
    expect(document.pages[1]?.elements[2]).toEqual({
      id: "p2-text-3",
      kind: "page-footer",
      text: "Page 2 of 3",
      runs: [{ text: "Page 2 of 3" }],
      evidence: "repeated",
      provenance: {
        pageNumber: 2,
        box: { x: 40, y: 780, width: 55, height: 12 },
        sourceIds: ["p2-text-3"],
        lineIds: ["p2-line-3"],
      },
    });
    expect(document.pages[0]?.elements[0]?.provenance).toEqual({
      pageNumber: 1,
      box: { x: 40, y: 20, width: 110, height: 12 },
      sourceIds: ["p1-text-1"],
      lineIds: ["p1-line-1"],
    });
  });

  it("reports page dimensions on every converted page", async () => {
    const result = await convert(acmeReport(), "markdown");
    expect(result.pages.map(({ pageNumber, width, height }) => ({ pageNumber, width, height }))).toEqual([
      { pageNumber: 1, width: 600, height: 800 },
      { pageNumber: 2, width: 600, height: 800 },
      { pageNumber: 3, width: 600, height: 800 },
    ]);
    const json = await convert(acmeReport(), "json");
    expect(json.pages.map((page) => [page.width, page.height])).toEqual([[600, 800], [600, 800], [600, 800]]);
  });

  it("detects alternating odd and even running heads and page numbers", async () => {
    const result = await convert(bookSpread(), "markdown");
    expect(result.pages.map((page) => summary(page.elements).filter((entry) => entry.startsWith("page-"))))
      .toEqual([1, 2, 3, 4, 5, 6].map((n) => [
        `page-header:repeated:${n % 2 === 1 ? "The Docture Handbook" : "Chapter 2: Layout"}`,
        `page-footer:repeated:${n}`,
        ...(n < 6 ? ["page-break"] : []),
      ]));
    expect(result.content).not.toContain("Handbook");
    expect(result.content).not.toContain("Chapter 2");
  });

  it("honors tagged header and footer hints inside the page bands on a single page", async () => {
    const result = await convert(documentOf([pdfPage(1, [
      { text: "Tagged running head", y: 20, role: "header" },
      { text: "Body.", y: 300 },
      { text: "Tagged mid-page footer", y: 400, role: "footer" },
      { text: "Tagged foot", y: 770, role: "footer" },
    ])]), "markdown");
    expect(summary(result.pages[0]?.elements ?? [])).toEqual([
      "page-header:tagged:Tagged running head",
      "paragraph:Body.",
      "paragraph:Tagged mid-page footer",
      "page-footer:tagged:Tagged foot",
    ]);
    expect(result.content).toBe("<!-- page: 1 -->\n\nBody.\n\nTagged mid-page footer");
  });

  it.each([
    { name: "a single untagged page", loaded: documentOf([pdfPage(1, [
      { text: "ACME Corp Confidential", y: 20 }, { text: "Body.", y: 100 }, { text: "Page 1 of 1", y: 780 },
    ])]) },
    { name: "two pages", loaded: acmeReport(2) },
    { name: "top lines that differ on every page", loaded: threePages((n) => ({ text: ["Summary", "Methods", "Results"][n - 1] ?? "", y: 20 })) },
    { name: "numbers that do not track the page", loaded: threePages((n) => ({ text: `Invoice ${[1043, 2210, 3381][n - 1]}`, y: 20 })) },
    { name: "repeated text at drifting heights", loaded: threePages((n) => ({ text: "ACME Corp Confidential", y: [10, 50, 10][n - 1] ?? 0 })) },
    { name: "repeated text outside the bands", loaded: threePages(() => ({ text: "ACME Corp Confidential", y: 120 })) },
    { name: "a repeated heading-size title", loaded: threePages(() => ({ text: "Annual Report", y: 20, size: 24 })) },
  ])("infers no furniture from $name", async ({ loaded }) => {
    const result = await convert(loaded, "json");
    const kinds = result.pages.flatMap((page) => page.elements.map((element) => element.kind));
    expect(kinds.filter((kind) => kind === "page-header" || kind === "page-footer")).toEqual([]);
  });

  it("keeps a table whose header row repeats at the top of every page", async () => {
    const loaded = documentOf([1, 2, 3].map((pageNumber) => pdfPage(pageNumber, [
      { text: "", y: 30, cells: [["Item", 40], ["Amount", 300]] },
      { text: "", y: 50, cells: [[`Row ${pageNumber}`, 40], [String(pageNumber * 10), 300]] },
      { text: "", y: 70, cells: [[`Row ${pageNumber}b`, 40], [String(pageNumber * 10 + 1), 300]] },
    ])));
    const result = await convert(loaded, "markdown");
    expect(result.pages.map((page) => page.elements.map((element) => element.kind))).toEqual([
      ["table", "page-break"], ["table", "page-break"], ["table"],
    ]);
    expect(result.content).toContain("| Item | Amount |\n| --- | --- |\n| Row 2 | 20 |");
  });

  it("detects a two-line footer whose cells line up like table rows", async () => {
    const loaded = documentOf([1, 2, 3].map((pageNumber) => pdfPage(pageNumber, [
      { text: `Body ${pageNumber}.`, y: 100 },
      { text: "", y: 750, cells: [["ACME Corp", 40], [`Page ${pageNumber} of 3`, 480]] },
      { text: "", y: 765, cells: [["1 Main St", 40], ["acme.example", 480]] },
    ])));
    const result = await convert(loaded, "json");
    expect(summary(result.pages[1]?.elements ?? [])).toEqual([
      "paragraph:Body 2.",
      "page-footer:repeated:ACME Corp Page 2 of 3",
      "page-footer:repeated:1 Main St acme.example",
      "page-break",
    ]);
  });

  it("keeps page-number footers when one page has a stray line with the same pattern", async () => {
    const loaded = documentOf([1, 2, 3, 4].map((pageNumber) => pdfPage(pageNumber, [
      { text: `Body ${pageNumber}.`, y: 100 },
      ...(pageNumber === 2 ? [{ text: "Page 9 of 12", y: 760 }] : []),
      { text: `Page ${pageNumber} of 4`, y: 780 },
    ])));
    const result = await convert(loaded, "json");
    expect(result.pages.map((page) => summary(page.elements).filter((entry) => entry !== "page-break"))).toEqual([
      ["paragraph:Body 1.", "page-footer:repeated:Page 1 of 4"],
      ["paragraph:Body 2.", "paragraph:Page 9 of 12", "page-footer:repeated:Page 2 of 4"],
      ["paragraph:Body 3.", "page-footer:repeated:Page 3 of 4"],
      ["paragraph:Body 4.", "page-footer:repeated:Page 4 of 4"],
    ]);
  });

  it("leaves text-only and dimensionless pages without furniture", async () => {
    const textOnly = documentOf([1, 2, 3].map((pageNumber) => ({
      pageNumber, width: 600, height: 800, text: `ACME Corp Confidential\n\nBody ${pageNumber}.`,
    })));
    const flat = documentOf([1, 2, 3].map((pageNumber) => ({
      ...pdfPage(pageNumber, [{ text: "ACME Corp Confidential", y: 0 }, { text: `Body ${pageNumber}.`, y: 0 }]),
      width: 0, height: 0,
    })));
    for (const loaded of [textOnly, flat]) {
      const result = await convert(loaded, "markdown");
      expect(result.content.match(/ACME Corp Confidential/gu)).toHaveLength(3);
    }
  });

  it("hides furniture from layout analyzers and ignores annotations that name it", async () => {
    const seen: string[][] = [];
    const result = await new DocumentConverter({
      layoutAnalyzer: {
        name: "probe",
        async analyze(ctx: LayoutAnalyzerContext) {
          seen.push(...ctx.document.pages.map((page) => page.elements.map((element) => element.id)));
          return {
            annotations: [
              { id: "p1-text-1", role: "heading" },
              { id: "p1-text-2", role: "heading", level: 2 },
            ],
          };
        },
      },
    }).convert({ loaded: acmeReport() }, { format: "markdown" });
    expect(seen).toEqual([
      ["p1-text-2", "p1-page-break"],
      ["p2-text-2", "p2-page-break"],
      ["p3-text-2"],
    ]);
    expect(result.method).toBe("deterministic+probe");
    expect(summary(result.pages[0]?.elements ?? [])).toEqual([
      "page-header:repeated:ACME Corp Confidential",
      "heading:Body text of page 1.",
      "page-footer:repeated:Page 1 of 3",
      "page-break",
    ]);
    expect(result.content.startsWith("<!-- page: 1 -->\n\n## Body text of page 1.")).toBe(true);
  });
});
