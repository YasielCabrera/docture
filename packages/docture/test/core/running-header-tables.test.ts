import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  parseDoctureDocument,
  provenanceSegments,
  type ConversionResult,
  type LoadedDocument,
  type TableElement,
} from "docture";
import { fixtureDocument, row, text, type FixtureLine } from "./continuation-fixtures.js";

async function convert(loaded: LoadedDocument, format: "json" | "markdown" = "json"): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded }, { format });
}

const tables = (result: ConversionResult): TableElement[] =>
  result.pages.flatMap((page) => page.elements.filter((element): element is TableElement => element.kind === "table"));

const texts = (result: ConversionResult): (readonly [string, string | undefined])[][] =>
  result.pages.map((page) => page.elements.map((element) => [element.kind, "text" in element ? element.text : undefined] as const));

const firstPage: readonly FixtureLine[] = [
  row(50, ["Report", 40], ["2026", 200]),
  text(100, "Overview of the report."),
  row(640, ["Item", 40], ["Amount", 200]),
  row(660, ["Alpha", 40], ["10", 200]),
  row(680, ["Beta", 40], ["20", 200]),
];

const secondPage: readonly FixtureLine[] = [
  row(50, ["Report", 40], ["2026", 200]),
  row(64, ["Gamma", 40], ["30", 200]),
  row(84, ["Delta", 40], ["40", 200]),
];

const tagged = (loaded: LoadedDocument, value: string): LoadedDocument => ({
  ...loaded,
  pages: loaded.pages.map((page) => ({
    ...page,
    blocks: (page.blocks ?? []).map((block) =>
      block.kind === "text" && block.lines[0]?.text === value ? { ...block, role: "header" as const } : block),
  })),
});

describe("a line repeated at the top of both pages of a two-page document", () => {
  it("keeps the line and the second page's rows out of the first page's table", async () => {
    const result = await convert(fixtureDocument(firstPage, secondPage));
    expect(tables(result).map((table) => table.rows)).toEqual([[["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"]]]);
    const [table] = tables(result);
    expect(table === undefined ? [] : provenanceSegments(table.provenance)).toEqual([
      {
        pageNumber: 1,
        box: { x: 40, y: 640, width: 190, height: 52 },
        sourceIds: ["p1-text-3", "p1-text-4", "p1-text-5"],
        lineIds: ["p1-line-3", "p1-line-4", "p1-line-5"],
      },
    ]);
    expect(texts(result)).toEqual([
      [["paragraph", "Report 2026"], ["paragraph", "Overview of the report."], ["table", undefined], ["page-break", undefined]],
      [["paragraph", "Report 2026"], ["paragraph", "Gamma 30"], ["paragraph", "Delta 40"]],
    ]);
    expect(result.pages[1]?.elements.map((element) => element.provenance.lineIds)).toEqual([["p2-line-1"], ["p2-line-2"], ["p2-line-3"]]);
    expect(result.warnings).toEqual([{
      code: "LAYOUT_DEGRADED",
      message: "Kept the table ending at p1-line-5 separate from p2-line-1 on page 2: \"Report 2026\" (p2-line-1) repeats at the same place on page 1 and may be a running header.",
      pageNumber: 2,
    }]);
    expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
  });

  it("renders the repeated line as text on each page and the table once", async () => {
    const markdown = await convert(fixtureDocument(firstPage, secondPage), "markdown");
    expect(markdown.content).toBe([
      "<!-- page: 1 -->",
      "Report 2026",
      "Overview of the report.",
      "| Item | Amount |\n| --- | --- |\n| Alpha | 10 |\n| Beta | 20 |",
      "<!-- page: 2 -->",
      "Report 2026",
      "Gamma 30",
      "Delta 40",
    ].join("\n\n"));
  });

  it("does not skip a repeated line set apart from the rows below it to join the table", async () => {
    const result = await convert(fixtureDocument(
      [text(30, "Quarterly report"), ...firstPage.slice(2)],
      [text(30, "Quarterly report"), row(100, ["Gamma", 40], ["30", 200]), row(120, ["Delta", 40], ["40", 200])],
    ));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows.length, table.provenance.continuations])).toEqual([
      [1, 3, undefined],
    ]);
    expect(result.warnings.map((warning) => [warning.code, warning.pageNumber])).toEqual([["LAYOUT_DEGRADED", 2]]);
  });

  it("joins the rows when the loader tags the repeated line as a page header", async () => {
    const result = await convert(tagged(fixtureDocument(firstPage, secondPage), "Report 2026"));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"], ["Gamma", "30"], ["Delta", "40"]],
    ]);
    expect(tables(result)[0]?.rowProvenance?.map((segment) => segment.lineIds)).toEqual([
      ["p1-line-3"], ["p1-line-4"], ["p1-line-5"], ["p2-line-2"], ["p2-line-3"],
    ]);
    expect(texts(result)[1]).toEqual([["page-header", "Report 2026"]]);
    expect(result.warnings).toEqual([]);
  });

  it("joins a table whose header row repeats at the top of both pages", async () => {
    const rows = Array.from({ length: 32 }, (_unused, index) => row(70 + index * 20, [`Row ${index + 1}`, 40], [String(index + 1), 200]));
    const result = await convert(fixtureDocument(
      [row(50, ["Item", 40], ["Amount", 200]), ...rows],
      [row(50, ["Item", 40], ["Amount", 200]), row(70, ["Row 33", 40], ["33", 200]), row(90, ["Row 34", 40], ["34", 200])],
    ));
    expect(tables(result).map((table) => [table.rows.length, table.rows[0], table.rows.at(-1)])).toEqual([
      [35, ["Item", "Amount"], ["Row 34", "34"]],
    ]);
    expect(tables(result)[0]?.sourceText?.split("\n").slice(-3) ?? []).toEqual(["Item Amount", "Row 33 33", "Row 34 34"]);
    expect(result.warnings).toEqual([]);
  });
});
