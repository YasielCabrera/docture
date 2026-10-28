import { describe, expect, it } from "vitest";
import { DocumentConverter, parseDoctureDocument, type ConversionResult, type LoadedDocument, type TableElement } from "docture";
import { centeredGroup } from "../../src/testing/fixtures/conversion-corpus/centered-group.js";
import { corpusDocument, letter, type CorpusLine } from "../../src/testing/fixtures/conversion-corpus/layout.js";

async function convert(loaded: LoadedDocument, format: "json" | "markdown" | "html" = "json"): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded }, { format });
}

const tables = (result: ConversionResult): TableElement[] =>
  result.pages.flatMap((page) => page.elements.filter((element): element is TableElement => element.kind === "table"));

const shape = (table: TableElement | undefined) =>
  table === undefined ? undefined : { rows: table.rows, headerRows: table.headerRows, spans: table.spans };

const label = (text: string, options: Partial<CorpusLine> = {}): CorpusLine => ({ y: 100, cells: [[text, 130 - text.length * 2.5]], ...options });

const probe = (top: CorpusLine, rows: readonly CorpusLine[] = []) => corpusDocument(letter(
  top,
  { y: 120, cells: [["One", 40, 80], ["Two", 140, 80]], bold: top.bold === true },
  { y: 140, cells: [["a", 40, 60], ["b", 140, 60]] },
  ...rows,
));

describe("a label centred over two table columns", () => {
  it("spans a bold label over both child columns of a bold header", async () => {
    const result = await convert(centeredGroup.loaded);
    expect(tables(result).map(shape)).toEqual([{
      rows: [["Item", "Quarters", ""], ["", "Q1", "Q2"], ["Alpha", "10", "20"], ["Beta", "30", "40"]],
      headerRows: 2,
      spans: [{ row: 0, col: 1, rowSpan: 1, colSpan: 2 }],
    }]);
    const html = await convert(centeredGroup.loaded, "html");
    expect(html.content).toContain("<th colspan=\"2\">Quarters</th>");
    expect(result.warnings).toEqual([]);
  });

  it("spans a lone bold label centred over a bold header row", async () => {
    const result = await convert(probe(label("Group", { bold: true })));
    expect(tables(result).map(shape)).toEqual([{
      rows: [["Group", ""], ["One", "Two"], ["a", "b"]],
      headerRows: 2,
      spans: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
    }]);
    expect(tables(result)[0]?.provenance.lineIds).toEqual(["p1-line-1", "p1-line-2", "p1-line-3"]);
    expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
  });

  it("keeps an unstyled centred label out of the table and warns", async () => {
    const result = await convert(probe(label("Group"), [{ y: 160, cells: [["c", 40, 60], ["d", 140, 60]] }]));
    expect(result.pages[0]?.elements.map((element) => element.kind === "table" ? element.rows : element.kind === "paragraph" ? element.text : element.kind)).toEqual([
      "Group",
      [["One", "Two"], ["a", "b"], ["c", "d"]],
    ]);
    expect(tables(result)[0]?.spans).toBeUndefined();
    expect(result.warnings).toEqual([{
      code: "LAYOUT_DEGRADED",
      message: "Kept \"Group\" (p1-line-1) out of the table below it: it is centred over 2 of the table's columns, but no bold header marks it as a group label.",
      pageNumber: 1,
    }]);
  });

  it.each([
    ["a bold caption", label("Table 1", { bold: true })],
    ["a bold caption with a letter", label("Table A", { bold: true })],
    ["a bold caption with a lettered number", label("Figure B-1", { bold: true })],
    ["a heading-size bold label", label("Group", { bold: true, fontSize: 16 })],
    ["a bold label far above the header", label("Group", { bold: true, y: 60 })],
  ])("keeps %s out of the table", async (_case, top) => {
    const result = await convert(probe(top, [{ y: 160, cells: [["c", 40, 60], ["d", 140, 60]] }]));
    expect(tables(result).flatMap((table) => table.rows.flat())).not.toContain(top.cells[0]?.[0]);
    expect(tables(result).map((table) => table.spans)).toEqual([undefined]);
    expect(result.warnings).toEqual([]);
  });
});
