import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  parseDoctureDocument,
  type DocumentElement,
  type LayoutAnalyzerContext,
  type LoadedDocument,
  type TableElement,
} from "../../src/core/index.js";
import {
  groupHeaderRows,
  narrowTableRows,
  overflowingDescriptionRows,
  partiesAboveTableRows,
  regionRows,
  rightTableRows,
  tableDocument,
  uniformRows,
  wordSpanRows,
  yearHeaderRows,
} from "./table-span-fixtures.js";
import { bySourceId } from "./conversion-fixtures.js";

async function convert(loaded: LoadedDocument, format: "markdown" | "html" | "text" | "json") {
  return new DocumentConverter().convert({ loaded }, { format });
}

function tables(elements: readonly DocumentElement[]): TableElement[] {
  return elements.filter((element): element is TableElement => element.kind === "table");
}

function bodyOf(html: string): string {
  return /<section[^>]*>\n([\s\S]*)\n<\/section>/u.exec(html)?.[1] ?? "";
}

describe("spanning table cells", () => {
  it("detects a group header over two columns as one table with two header rows", async () => {
    const result = await convert(tableDocument(groupHeaderRows), "html");
    const elements = result.pages[0]?.elements ?? [];
    expect(elements.map((element) => element.kind)).toEqual(["table"]);
    const [table] = tables(elements);
    expect(table?.rows).toEqual([["Item", "Quarters", ""], ["", "Q1", "Q2"], ["Alpha", "10", "20"], ["Beta", "30", "40"]]);
    expect(table?.headerRows).toBe(2);
    expect(table?.spans).toEqual([{ row: 0, col: 1, rowSpan: 1, colSpan: 2 }]);
    expect(bodyOf(result.content)).toBe(
      "<table><thead><tr><th>Item</th><th colspan=\"2\">Quarters</th></tr><tr><th></th><th>Q1</th><th>Q2</th></tr></thead>" +
        "<tbody><tr><td>Alpha</td><td>10</td><td>20</td></tr><tr><td>Beta</td><td>30</td><td>40</td></tr></tbody></table>",
    );
  });

  it("flattens multi-row headers into one Markdown header row", async () => {
    const result = await convert(tableDocument(groupHeaderRows), "markdown");
    expect(result.content).toBe([
      "<!-- page: 1 -->",
      "",
      "| Item | Quarters / Q1 | Quarters / Q2 |",
      "| --- | --- | --- |",
      "| Alpha | 10 | 20 |",
      "| Beta | 30 | 40 |",
    ].join("\n"));
  });

  it("keeps the source lines for TXT output", async () => {
    const result = await convert(tableDocument(groupHeaderRows), "text");
    expect(result.content).toBe("Item Quarters\nQ1 Q2\nAlpha 10 20\nBeta 30 40");
  });

  it("emits a row span only when a cell box covers the next row's line", async () => {
    const result = await convert(tableDocument(regionRows(30)), "html");
    const [table] = tables(result.pages[0]?.elements ?? []);
    expect(table?.rows).toEqual([["Region", "Q1", "Q2"], ["North", "10", "20"], ["", "11", "21"], ["South", "30", "40"]]);
    expect(table?.headerRows).toBe(1);
    expect(table?.spans).toEqual([{ row: 1, col: 0, rowSpan: 2, colSpan: 1 }]);
    expect(bodyOf(result.content)).toBe(
      "<table><thead><tr><th>Region</th><th>Q1</th><th>Q2</th></tr></thead><tbody>" +
        "<tr><td rowspan=\"2\">North</td><td>10</td><td>20</td></tr><tr><td>11</td><td>21</td></tr>" +
        "<tr><td>South</td><td>30</td><td>40</td></tr></tbody></table>",
    );
    const markdown = await convert(tableDocument(regionRows(30)), "markdown");
    expect(markdown.content.split("\n").slice(2)).toEqual([
      "| Region | Q1 | Q2 |",
      "| --- | --- | --- |",
      "| North | 10 | 20 |",
      "|  | 11 | 21 |",
      "| South | 30 | 40 |",
    ]);
  });

  it("never infers a row span from an empty slot alone", async () => {
    const result = await convert(tableDocument(regionRows(12)), "json");
    const [table] = tables(result.pages[0]?.elements ?? []);
    expect(table?.rows).toEqual([["Region", "Q1", "Q2"], ["North", "10", "20"], ["", "11", "21"], ["South", "30", "40"]]);
    expect(table?.headerRows).toBe(1);
    expect(table !== undefined && "spans" in table).toBe(false);
  });

  it("places an overflowing description in its own column instead of spanning", async () => {
    const result = await convert(tableDocument(overflowingDescriptionRows), "markdown");
    const [table] = tables(result.pages[0]?.elements ?? []);
    expect(table?.rows).toEqual([
      ["Item", "Qty", "Price"],
      ["Widget", "2", "9.50"],
      ["Consulting services for the audit", "", "120.00"],
      ["Gadget", "1", "4.25"],
    ]);
    expect(table?.headerRows).toBe(1);
    expect(table !== undefined && "spans" in table).toBe(false);
  });

  it("labels a column under an empty slot of a spanning header row", async () => {
    const result = await convert(tableDocument(yearHeaderRows), "markdown");
    const [table] = tables(result.pages[0]?.elements ?? []);
    expect(table?.headerRows).toBe(2);
    expect(table?.spans).toEqual([
      { row: 0, col: 1, rowSpan: 1, colSpan: 2 },
      { row: 0, col: 3, rowSpan: 1, colSpan: 2 },
    ]);
    expect(result.content.split("\n")[2]).toBe("| Item | FY 2024 / Q1 | FY 2024 / Q2 | FY 2025 / Q1 | FY 2025 / Q2 |");
  });

  it("keeps a shorter line above a table out of its header without a column span", async () => {
    const result = await convert(tableDocument(partiesAboveTableRows), "markdown");
    const elements = result.pages[0]?.elements ?? [];
    expect(elements.map((element) => element.kind)).toEqual(["paragraph", "table"]);
    const [table] = tables(elements);
    expect(table?.rows).toEqual([["Name", "Units", "Total"], ["Alpha", "3", "30"], ["Beta", "4", "40"], ["", "Total", "70"]]);
    expect(table?.headerRows).toBe(1);
  });

  it("does not treat word-level spans as cells of a band table", async () => {
    const result = await convert(tableDocument(wordSpanRows), "html");
    expect(bodyOf(result.content)).toBe(
      "<p>Drive belt #163 4</p>\n<p>Drive belt #164 13</p>\n<p>Pressure #165 6</p>\n<p>Drive belt #166 15</p>",
    );
  });

  it("joins a totals row below a table but not a two-cell footer far below it", async () => {
    const result = await convert(tableDocument([
      ...uniformRows,
      { y: 172, cells: [["Total", 200], ["70", 300]] },
      { y: 780, cells: [["ACME Corp Confidential", 40], ["Page 1 of 1", 300]] },
    ]), "json");
    const elements = result.pages[0]?.elements ?? [];
    expect(tables(elements).map((table) => table.rows)).toEqual([
      [["Name", "Units", "Total"], ["Alpha", "3", "30"], ["Beta", "4", "40"], ["", "Total", "70"]],
    ]);
    expect(elements.map((element) => element.kind)).toEqual(["table", "paragraph"]);
  });

  it.each([
    ["an equal-width table", uniformRows, 300, [["Name", "Units", "Total"], ["Alpha", "3", "30"], ["Beta", "4", "40"]]],
    ["a band table", groupHeaderRows, 230, [["Item", "Quarters", ""], ["", "Q1", "Q2"], ["Alpha", "10", "20"], ["Beta", "30", "40"]]],
  ])("keeps a footer with the same columns far below %s out of it", async (_case, rows, lastColumn, expected) => {
    const result = await convert(tableDocument([
      ...rows,
      { y: 780, cells: [["Page", 40], ["1", 200], ["2", lastColumn]] },
    ]), "json");
    const elements = result.pages[0]?.elements ?? [];
    expect(tables(elements).map((table) => table.rows)).toEqual([expected]);
    expect(elements.map((element) => element.kind)).toEqual(["table", "paragraph"]);
  });

  it("converts a table without merged cells as before, with row provenance in its JSON", async () => {
    const markdown = await convert(tableDocument(uniformRows), "markdown");
    expect(markdown.content).toBe([
      "<!-- page: 1 -->",
      "",
      "| Name | Units | Total |",
      "| --- | --- | --- |",
      "| Alpha | 3 | 30 |",
      "| Beta | 4 | 40 |",
    ].join("\n"));
    const html = await convert(tableDocument(uniformRows), "html");
    expect(bodyOf(html.content)).toBe(
      "<table><thead><tr><th>Name</th><th>Units</th><th>Total</th></tr></thead>" +
        "<tbody><tr><td>Alpha</td><td>3</td><td>30</td></tr><tr><td>Beta</td><td>4</td><td>40</td></tr></tbody></table>",
    );
    const json = await convert(tableDocument(uniformRows), "json");
    expect(JSON.parse(json.content).pages[0].elements[0]).toEqual({
      id: "p1-9cecc64ac022",
      kind: "table",
      rows: [["Name", "Units", "Total"], ["Alpha", "3", "30"], ["Beta", "4", "40"]],
      headerRows: 1,
      rowProvenance: [
        { pageNumber: 1, box: { x: 40, y: 100, width: 285, height: 12 }, sourceIds: ["p1-text-1"], lineIds: ["p1-line-1"] },
        { pageNumber: 1, box: { x: 40, y: 120, width: 270, height: 12 }, sourceIds: ["p1-text-2"], lineIds: ["p1-line-2"] },
        { pageNumber: 1, box: { x: 40, y: 140, width: 270, height: 12 }, sourceIds: ["p1-text-3"], lineIds: ["p1-line-3"] },
      ],
      sourceText: "Name Units Total\nAlpha 3 30\nBeta 4 40",
      provenance: {
        pageNumber: 1,
        box: { x: 40, y: 100, width: 285, height: 52 },
        sourceIds: ["p1-text-1", "p1-text-2", "p1-text-3"],
        lineIds: ["p1-line-1", "p1-line-2", "p1-line-3"],
      },
    });
  });

  it("writes span tables that the saved-document parser accepts", async () => {
    for (const rows of [groupHeaderRows, regionRows(30)]) {
      const json = await convert(tableDocument(rows), "json");
      const parsed = parseDoctureDocument(JSON.parse(json.content));
      expect(parsed.ok).toBe(true);
    }
  });
});

describe("saved table spans", () => {
  async function savedProbe(): Promise<any> {
    return JSON.parse((await convert(tableDocument(groupHeaderRows), "json")).content);
  }

  function issuesOf(value: unknown) {
    const parsed = parseDoctureDocument(value);
    return parsed.ok ? [] : parsed.issues;
  }

  const table = "pages.0.elements.0";

  it("rejects spans that break the table rules", async () => {
    const cases: [(table: any) => void, { path: string; message: string }[]][] = [
      [(t) => { t.spans = [{ row: 0, col: 1, rowSpan: 1, colSpan: 3 }]; }, [{ path: `${table}.spans.0`, message: "must fit inside the 4x3 table" }]],
      [(t) => { t.spans = [{ row: 1, col: 1, rowSpan: 2, colSpan: 1 }]; t.rows[2][1] = ""; t.rows[0][2] = ""; }, [{ path: `${table}.spans.0`, message: "must not cross the header boundary at row 2" }]],
      [(t) => { t.spans = [{ row: 0, col: 1, rowSpan: 1, colSpan: 1 }]; }, [{ path: `${table}.spans.0`, message: "must cover more than one cell" }]],
      [(t) => { t.rows[0][2] = "Q"; }, [{ path: `${table}.rows.0.2`, message: "must be \"\" because span 0 covers it" }]],
      [(t) => { t.spans.push({ row: 0, col: 0, rowSpan: 2, colSpan: 2 }); t.rows[1][0] = ""; }, [
        { path: `${table}.spans.1`, message: "must follow the previous span in row, then column order" },
        { path: `${table}.spans.1`, message: "overlaps span 0 at row 0, column 1" },
      ]],
      [(t) => { t.rows[3].pop(); }, [{ path: `${table}.rows.3`, message: "must have 3 cells like row 0 when spans are present" }]],
      [(t) => { t.headerRows = 5; }, [{ path: `${table}.headerRows`, message: "must be at most the row count 4" }]],
      [(t) => { t.spans = []; }, [{ path: `${table}.spans`, message: "must have at least 1 item" }]],
      [(t) => { t.spans[0].colSpan = 1.5; }, [{ path: `${table}.spans.0.colSpan`, message: "must be an integer" }]],
    ];
    for (const [edit, expected] of cases) {
      const saved = await savedProbe();
      edit(saved.pages[0].elements[0]);
      expect(issuesOf(saved)).toEqual(expected);
    }
  });
});

describe("table group annotations", () => {
  function grouping(ids: readonly string[]) {
    return new DocumentConverter({
      layoutAnalyzer: {
        name: "grouper",
        async analyze(ctx: LayoutAnalyzerContext) {
          return { annotations: bySourceId(ctx.document, ids.map((id) => ({ id, group: "g" }))) };
        },
      },
    });
  }

  it("offsets the spans of an appended table", async () => {
    const loaded = tableDocument([...rightTableRows, ...groupHeaderRows]);
    const result = await grouping(["p1-text-1", "p1-text-4"]).convert({ loaded }, { format: "json" });
    const [table] = tables(result.pages[0]?.elements ?? []);
    expect(table?.rows).toEqual([
      ["Code", "Units", "Total"], ["A1", "3", "30"], ["B2", "4", "40"],
      ["Item", "Quarters", ""], ["", "Q1", "Q2"], ["Alpha", "10", "20"], ["Beta", "30", "40"],
    ]);
    expect(table?.headerRows).toBe(1);
    expect(table?.spans).toEqual([{ row: 3, col: 1, rowSpan: 1, colSpan: 2 }]);
    expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
  });

  it("ignores a group whose merged table would break the span rules", async () => {
    const loaded = tableDocument([...groupHeaderRows, ...narrowTableRows]);
    const result = await grouping(["p1-text-1", "p1-text-5"]).convert({ loaded }, { format: "json" });
    const found = tables(result.pages[0]?.elements ?? []);
    expect(found.map((table) => table.rows.length)).toEqual([4, 3]);
    expect(result.method).toBe("deterministic+grouper");
    expect(result.warnings).toEqual([]);
    expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
  });
});
