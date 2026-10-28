import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  parseDoctureDocument,
  type DocumentElement,
  type LayoutAnalyzer,
  type LayoutDocument,
  type LoadedDocument,
} from "../../src/core/index.js";
import { continuationRows, fixtureDocument, pageNumberFooter, tableAtPageBottom, text, unfinishedParagraph } from "./continuation-fixtures.js";
import { richDocument } from "./conversion-fixtures.js";
import { acmeReport, documentOf, pdfPage } from "./furniture-fixtures.js";

async function elements(loaded: LoadedDocument, converter = new DocumentConverter()): Promise<DocumentElement[]> {
  const result = await converter.convert({ loaded }, { format: "json" });
  return result.pages.flatMap((page) => page.elements);
}

const withText = (all: readonly DocumentElement[], value: string): DocumentElement | undefined =>
  all.find((element) => "text" in element && element.text === value);

const idOf = (document: LayoutDocument, sourceId: string): string =>
  document.pages.flatMap((page) => page.elements).find((element) => element.provenance.sourceIds[0] === sourceId)?.id ?? sourceId;

function textOnly(...pages: readonly string[]): LoadedDocument {
  return {
    loader: "text-fixture",
    form: "digital",
    text: pages.join("\f"),
    pages: pages.map((value, index) => ({ pageNumber: index + 1, width: 0, height: 0, text: value })),
  };
}

describe("converted element ids", () => {
  it("keeps an element's id when an unrelated block is inserted above it", async () => {
    const before = withText(await elements(fixtureDocument([text(100, "Revenue grew 12%.")])), "Revenue grew 12%.");
    const after = withText(
      await elements(fixtureDocument([text(60, "Preface"), text(100, "Revenue grew 12%.")])),
      "Revenue grew 12%.",
    );
    expect(before?.id).toBe("p1-781fe8d7e13c");
    expect(after?.id).toBe("p1-781fe8d7e13c");
    expect(before?.provenance.sourceIds).toEqual(["p1-text-1"]);
    expect(after?.provenance.sourceIds).toEqual(["p1-text-2"]);
    expect(after?.provenance.lineIds).toEqual(["p1-line-2"]);
  });

  it("gives the same ids when the same document is converted twice", async () => {
    const first = (await elements(richDocument())).map((element) => element.id);
    const second = (await elements(richDocument())).map((element) => element.id);
    expect(second).toEqual(first);
  });

  it("gives identical paragraphs at different positions different ids", async () => {
    const all = await elements(fixtureDocument([text(100, "Revenue grew 12%."), text(300, "Revenue grew 12%.")]));
    expect(all.map((element) => element.id)).toEqual(["p1-781fe8d7e13c", "p1-a3623c330a05"]);
  });

  it("keeps a paragraph's id when an inserted smaller block makes it read as a heading", async () => {
    const before = await elements(documentOf([pdfPage(1, [{ text: "Revenue grew 12%.", y: 100, size: 12 }])]));
    const after = await elements(documentOf([pdfPage(1, [
      { text: "Draft", y: 60, size: 8 },
      { text: "Revenue grew 12%.", y: 100, size: 12 },
    ])]));
    expect(withText(before, "Revenue grew 12%.")).toMatchObject({ kind: "paragraph", id: "p1-781fe8d7e13c" });
    expect(withText(after, "Revenue grew 12%.")).toMatchObject({ kind: "heading", id: "p1-781fe8d7e13c" });
  });

  it("suffixes exact duplicates on a text-only page in document order", async () => {
    const all = await elements(textOnly("Preamble.", "Signed.\n\nSigned."));
    expect(all.map((element) => [element.id, element.kind])).toEqual([
      ["p1-82aec19d48d0", "paragraph"],
      ["p1-page-break", "page-break"],
      ["p2-a414d545b1f8", "paragraph"],
      ["p2-a414d545b1f8-2", "paragraph"],
    ]);
  });

  it("ignores whitespace differences in text", async () => {
    for (const value of ["Revenue grew  12%.", "Revenue grew 12%.", " Revenue grew 12%. "]) {
      const [element] = await elements(fixtureDocument([text(100, value)]));
      expect(element?.id).toBe("p1-781fe8d7e13c");
    }
  });

  it("derives one id for each element kind", async () => {
    const rich = await elements(richDocument());
    expect(rich.map((element) => [element.kind, element.id])).toEqual([
      ["heading", "p1-343e1b4c2a6a"],
      ["paragraph", "p1-3cb7badb93ad"],
      ["list", "p1-90c7cdc16a27"],
      ["table", "p1-001b110e4171"],
      ["code", "p1-92ae2367b403"],
      ["figure", "p1-8b9ae98bd898"],
      ["page-break", "p1-page-break"],
      ["paragraph", "p2-d09b3199b518"],
    ]);
    const furniture = await elements(acmeReport());
    expect(furniture.slice(0, 3).map((element) => [element.kind, element.id])).toEqual([
      ["page-header", "p1-336c32c7e8ed"],
      ["paragraph", "p1-45ebf7eff336"],
      ["page-footer", "p1-78e54700ec8b"],
    ]);
  });

  it("derives a continued table's id from its start page and the rows of every page", async () => {
    const [table] = await elements(fixtureDocument(tableAtPageBottom, continuationRows));
    expect(table?.id).toBe("p1-010d3a61615a");
    expect(table?.provenance.continuations?.map((segment) => segment.sourceIds)).toEqual([
      ["p2-text-1", "p2-text-2", "p2-text-3"],
    ]);
    const [edited] = await elements(fixtureDocument(tableAtPageBottom, [...continuationRows.slice(0, 2), text(140, "Epsilon 51")]));
    expect(edited?.id).not.toBe("p1-010d3a61615a");
  });

  it("derives a continued paragraph's id from its start page and its joined text", async () => {
    const all = await elements(fixtureDocument(
      [text(100, "Annual summary"), unfinishedParagraph, pageNumberFooter(1)],
      [text(30, "Annual summary"), text(100, "growth to continue next year."), text(120, "Costs were flat."), pageNumberFooter(2)],
    ));
    const joined = all.find((element) => element.provenance.continuations !== undefined);
    expect(joined?.id).toBe("p1-30d6ea65d838");
    expect(joined?.provenance.sourceIds).toEqual(["p1-text-2"]);
    expect(joined?.provenance.continuations?.map((segment) => segment.sourceIds)).toEqual([["p2-text-2"]]);
  });

  it("writes ids that are unique across the document and parse back", async () => {
    const result = await new DocumentConverter().convert({ loaded: acmeReport() }, { format: "json" });
    const ids = result.pages.flatMap((page) => page.elements.map((element) => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
  });

  it("keeps the deterministic id on elements a layout analyzer retypes or groups", async () => {
    const analyzer: LayoutAnalyzer = {
      name: "fixture",
      async analyze({ document }) {
        return {
          annotations: [
            { id: idOf(document, "p1-text-1"), role: "heading", level: 1 },
            { id: idOf(document, "p1-text-2"), group: "g" },
            { id: idOf(document, "p1-text-3"), group: "g" },
          ],
        };
      },
    };
    const all = await elements(
      fixtureDocument([text(100, "Alpha"), text(120, "Beta"), text(140, "Gamma")]),
      new DocumentConverter({ layoutAnalyzer: analyzer }),
    );
    expect(all.map((element) => [element.kind, element.id])).toEqual([
      ["heading", "p1-13f6ed79a2ee"],
      ["paragraph", "p1-0ea25dfd95a9"],
    ]);
  });
});
