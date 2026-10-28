import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  isLineSourceId,
  readDocument,
  silentLogger,
  sourceLines,
  type DoctureDocument,
  type DocumentLoader,
} from "../../src/core/index.js";
import { DocumentLoaderMuPdf } from "../../src/loaders/mupdf/index.js";
import { DocumentLoaderPdfJs } from "../../src/loaders/pdfjs/index.js";
import { makeRichDocumentPdf } from "../../src/testing/fixtures/index.js";
import { line, span } from "./conversion-fixtures.js";
import { pdfPage } from "./furniture-fixtures.js";

describe("source lines", () => {
  it("enumerates a page's positioned lines with canonical ids, boxes and verbatim text", () => {
    const page = pdfPage(2, [{ text: "Total due", y: 40 }, { text: "", y: 60, cells: [["Alpha", 40], ["10", 300]] }]);
    expect(sourceLines(page)).toEqual([
      { id: "p2-line-1", pageNumber: 2, box: { x: 40, y: 40, width: 45, height: 12 }, text: "Total due" },
      { id: "p2-line-2", pageNumber: 2, box: { x: 40, y: 60, width: 270, height: 12 }, text: "Alpha 10" },
    ]);
    expect(sourceLines({ pageNumber: 1, lines: [line(30, [], "spanless")] })).toEqual([
      { id: "p1-line-1", pageNumber: 1, box: { x: 0, y: 30, width: 0, height: 12 }, text: "spanless" },
    ]);
    expect(sourceLines({ pageNumber: 1 })).toEqual([]);
  });

  it("accepts only the anchored canonical line id form", () => {
    expect(["p1-line-1", "p12-line-340"].map(isLineSourceId)).toEqual([true, true]);
    expect(["p0-line-1", "p1-line-0", "p01-line-1", "p1-line-01", "xp1-line-1", "p1-line-1x", "p1-text-1", "p1-line-"]
      .map(isLineSourceId)).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("gives line-mode conversion candidates the enumerator's ids", async () => {
    const lines = [line(40, [span("First line", 20, 40)]), line(60, [span("Second line", 20, 60)])];
    const loaded = {
      loader: "ocr", form: "scanned" as const, text: "First line\nSecond line",
      pages: [{ pageNumber: 3, width: 600, height: 800, text: "First line\nSecond line", lines }],
    };
    const result = await new DocumentConverter().convert({ loaded }, { format: "json" });
    expect(result.pages[0]?.elements.map((element) => [element.id, element.provenance.lineIds])).toEqual([
      ["p3-line-1", ["p3-line-1"]],
      ["p3-line-2", ["p3-line-2"]],
    ]);
    expect(sourceLines(loaded.pages[0]!).map((source) => source.id)).toEqual(["p3-line-1", "p3-line-2"]);
  });

  it.each([
    { name: "pdf.js", loader: () => new DocumentLoaderPdfJs() },
    { name: "MuPDF", loader: () => new DocumentLoaderMuPdf() },
  ])("resolves every converted line id against an extraction-side $name load", async ({ loader }) => {
    const fixture = await makeRichDocumentPdf();
    const raw = { bytes: fixture.bytes, mimeType: "application/pdf" };
    const read = (instance: DocumentLoader, request?: { layout: boolean; assets: boolean }) =>
      readDocument([instance], raw, silentLogger, new AbortController().signal, undefined, request);
    const extraction = await read(loader());
    const conversionSide = await read(loader(), { layout: true, assets: false });
    const extractionLines = extraction.document.pages.map((page) => sourceLines(page));
    expect(conversionSide.document.pages.map((page) => sourceLines(page))).toEqual(extractionLines);

    const result = await new DocumentConverter({ loaders: [loader()] })
      .convert({ bytes: fixture.bytes, mimeType: "application/pdf" }, { format: "json" });
    const document = JSON.parse(result.content) as DoctureDocument;
    const resolved = document.pages.flatMap((page) => page.elements.flatMap((element) =>
      (element.provenance.lineIds ?? []).map((id) => {
        const source = extractionLines[page.pageNumber - 1]?.find((candidate) => candidate.id === id);
        return { page: page.pageNumber, id, found: source !== undefined && source.pageNumber === page.pageNumber };
      })));
    expect(resolved.length).toBeGreaterThan(3);
    expect(resolved.filter((entry) => !entry.found)).toEqual([]);
  });
});
