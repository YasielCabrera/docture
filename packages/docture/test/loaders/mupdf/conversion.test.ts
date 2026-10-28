import { describe, expect, it } from "vitest";
import { DocumentConverter, type ConversionResult, type DocumentElement } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { makeRichDocumentPdf } from "docture/testing/fixtures";
import { DocumentLoaderMuPdf } from "../../../src/loaders/mupdf/index.js";

function elementText(element: DocumentElement): string[] {
  switch (element.kind) {
    case "heading":
    case "paragraph":
    case "code":
    case "page-header":
    case "page-footer":
      return [element.text];
    case "list":
      return element.items.map((item) => item.text);
    case "table":
      return element.rows.flat();
    case "figure":
    case "page-break":
      return [];
  }
}

function sourceWords(result: ConversionResult): string[] {
  return result.pages
    .flatMap((page) => page.elements)
    .flatMap(elementText)
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9]+/gu)
    ?.sort() ?? [];
}

function semanticContent(result: ConversionResult): string {
  return result.pages.flatMap((page) => page.elements).flatMap(elementText).join(" ");
}

function normalized(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function links(result: ConversionResult): string[] {
  return result.pages
    .flatMap((page) => page.elements)
    .flatMap((element) => {
      if (element.kind === "heading" || element.kind === "paragraph") return element.runs;
      if (element.kind === "list") return element.items.flatMap((item) => item.runs);
      return [];
    })
    .flatMap((run) => (run.href === undefined ? [] : [run.href]));
}

describe("PDF loader conversion equivalence", () => {
  it("preserves the complete rich fixture through PDF.js and MuPDF", async () => {
    const fixture = await makeRichDocumentPdf();
    const raw = {
      bytes: fixture.bytes,
      mimeType: "application/pdf",
      fileName: "rich.pdf",
    } as const;
    const [pdfjs, mupdf] = await Promise.all([
      new DocumentConverter({ loaders: [new DocumentLoaderPdfJs()] }).convert(raw),
      new DocumentConverter({ loaders: [new DocumentLoaderMuPdf()] }).convert(raw),
    ]);

    expect(pdfjs.pages).toHaveLength(2);
    expect(mupdf.pages).toHaveLength(2);
    for (const expected of fixture.expected.sourceText) {
      expect(normalized(semanticContent(pdfjs))).toContain(normalized(expected));
      expect(normalized(semanticContent(mupdf))).toContain(normalized(expected));
    }
    expect(sourceWords(pdfjs)).toEqual(sourceWords(mupdf));
    expect(links(pdfjs)).toContain(fixture.expected.linkHref);
    expect(links(mupdf)).toContain(fixture.expected.linkHref);
    for (const result of [pdfjs, mupdf]) {
      const content = semanticContent(result);
      expect(content.indexOf(fixture.expected.leftColumn[1] ?? "")).toBeLessThan(
        content.indexOf(fixture.expected.rightColumn[0] ?? ""),
      );
      const tables = result.pages
        .flatMap((page) => page.elements)
        .filter((element) => element.kind === "table");
      expect(tables.some((table) => table.rows.flat().join(" ").includes("Metric Value Accuracy 100 Pages 2")))
        .toBe(true);
    }
    expect(pdfjs.pages.flatMap((page) => page.elements).some((element) => element.kind === "heading"))
      .toBe(true);
    expect(mupdf.pages.flatMap((page) => page.elements).some((element) => element.kind === "heading"))
      .toBe(true);
    expect(pdfjs.pages.flatMap((page) => page.elements).some((element) => element.kind === "figure"))
      .toBe(true);
    expect(mupdf.pages.flatMap((page) => page.elements).some((element) => element.kind === "figure"))
      .toBe(true);
    expect(pdfjs.assets.length).toBeGreaterThan(0);
    expect(mupdf.assets.length).toBeGreaterThan(0);
  });
});
