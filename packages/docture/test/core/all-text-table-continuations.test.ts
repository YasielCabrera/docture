import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  parseDoctureDocument,
  provenanceSegments,
  type ConversionResult,
  type LoadedDocument,
  type TableElement,
} from "docture";
import { boldRow, fixtureDocument, row, text, type FixtureLine } from "./continuation-fixtures.js";

async function convert(loaded: LoadedDocument): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded }, { format: "json" });
}

const tables = (result: ConversionResult): TableElement[] =>
  result.pages.flatMap((page) => page.elements.filter((element): element is TableElement => element.kind === "table"));

const statusTable: readonly FixtureLine[] = [
  row(640, ["Name", 40], ["Status", 200]),
  row(660, ["Alice", 40], ["Active", 200]),
  row(680, ["Bob", 40], ["Inactive", 200]),
];

const moreStaff: readonly FixtureLine[] = [
  row(120, ["Carol", 40], ["Active", 200]),
  row(140, ["Dave", 40], ["Inactive", 200]),
];

const joinedRows = [["Name", "Status"], ["Alice", "Active"], ["Bob", "Inactive"], ["Carol", "Active"], ["Dave", "Inactive"]];

describe("text-only tables at a page break", () => {
  it("keeps an unrelated text-only grid in the same columns on its own page", async () => {
    const result = await convert(fixtureDocument(statusTable, [
      row(100, ["Other", 40], ["Section", 200]),
      row(120, ["New", 40], ["Topic", 200]),
      row(140, ["Third", 40], ["Subject", 200]),
    ]));
    expect(tables(result).map((table) => [table.rows, table.provenance.continuations])).toEqual([
      [[["Name", "Status"], ["Alice", "Active"], ["Bob", "Inactive"]], undefined],
      [[["Other", "Section"], ["New", "Topic"], ["Third", "Subject"]], undefined],
    ]);
    expect(tables(result).map((table) => provenanceSegments(table.provenance).map((segment) => [segment.pageNumber, segment.lineIds]))).toEqual([
      [[1, ["p1-line-1", "p1-line-2", "p1-line-3"]]],
      [[2, ["p2-line-1", "p2-line-2", "p2-line-3"]]],
    ]);
    expect(result.warnings).toEqual([{
      code: "LAYOUT_DEGRADED",
      message: "Kept the table ending at p1-line-3 separate from p2-line-1 on page 2: its rows hold only text, and the page repeats neither the table's header nor a continuation line for its caption.",
      pageNumber: 2,
    }]);
    expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
  });

  it("joins rows that follow a repeated copy of the table's header", async () => {
    const result = await convert(fixtureDocument(statusTable, [row(100, ["Name", 40], ["Status", 200]), ...moreStaff]));
    expect(tables(result).map((table) => table.rows)).toEqual([joinedRows]);
    expect(tables(result)[0]?.sourceText).toBe("Name Status\nAlice Active\nBob Inactive\nName Status\nCarol Active\nDave Inactive");
    expect(tables(result)[0]?.rowProvenance?.map((segment) => segment.lineIds)).toEqual([
      ["p1-line-1"], ["p1-line-2"], ["p1-line-3"], ["p2-line-2"], ["p2-line-3"],
    ]);
    expect(result.pages[1]?.elements).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("joins rows under a continuation line that names the table's caption", async () => {
    const result = await convert(fixtureDocument(
      [text(600, "Table 4: Staff"), ...statusTable],
      [text(100, "Table 4 (continued)"), ...moreStaff],
    ));
    expect(tables(result).map((table) => table.rows)).toEqual([joinedRows]);
    expect(tables(result)[0]?.sourceText).toBe("Name Status\nAlice Active\nBob Inactive\nTable 4 (continued)\nCarol Active\nDave Inactive");
    expect(tables(result)[0]?.provenance.continuations?.map((segment) => segment.lineIds)).toEqual([["p2-line-1", "p2-line-2", "p2-line-3"]]);
    expect(result.pages[1]?.elements).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps rows separate under a continuation line for another table", async () => {
    const result = await convert(fixtureDocument(
      [text(600, "Table 4: Staff"), ...statusTable],
      [text(100, "Table 5 (continued)"), ...moreStaff],
    ));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows.length])).toEqual([[1, 3]]);
    expect(result.pages[1]?.elements[0]).toMatchObject({ kind: "paragraph", text: "Table 5 (continued)" });
    expect(result.warnings).toEqual([]);
  });

  it.each([3, 4])("joins every page under a repeated continuation line in the top margin of a %i-page table", async (pageCount) => {
    const people = (page: number) => Array.from({ length: 30 }, (_unused, index) =>
      row(100 + index * 20, [`Person ${page}-${index}`, 40], [index % 2 === 0 ? "Active" : "Inactive", 200]));
    const continued = Array.from({ length: pageCount - 1 }, (_unused, index) => [text(40, "Table 4 (continued)"), ...people(index + 2)]);
    const result = await convert(fixtureDocument([text(600, "Table 4: Staff"), ...statusTable], ...continued));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows.length, table.rows.at(-1)])).toEqual([
      [1, 3 + 30 * (pageCount - 1), [`Person ${pageCount}-29`, "Inactive"]],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps rows separate under a top-margin continuation line for another table", async () => {
    const result = await convert(fixtureDocument(
      [text(600, "Table 4: Staff"), ...statusTable],
      [text(40, "Table 5 (continued)"), row(100, ["Name", 40], ["Status", 200]), ...moreStaff],
    ));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows.length])).toEqual([[1, 3], [2, 3]]);
    expect(result.warnings).toEqual([]);
  });

  it("does not join a repeated header under a new section title", async () => {
    const result = await convert(fixtureDocument(statusTable, [
      boldRow(40, ["Contractors", 40]),
      row(100, ["Name", 40], ["Status", 200]),
      ...moreStaff,
    ]));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows])).toEqual([
      [1, [["Name", "Status"], ["Alice", "Active"], ["Bob", "Inactive"]]],
      [2, [["Name", "Status"], ["Carol", "Active"], ["Dave", "Inactive"]]],
    ]);
    expect(result.pages[1]?.elements[0]).toMatchObject({ kind: "heading", text: "Contractors" });
    expect(result.warnings).toEqual([]);
  });
});
