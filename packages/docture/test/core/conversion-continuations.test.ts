import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  parseDoctureDocument,
  provenanceSegments,
  sourceLines,
  type ConversionResult,
  type DocumentElement,
  type LayoutAnnotation,
  type LoadedDocument,
  type ParagraphElement,
  type TableElement,
} from "../../src/core/index.js";
import {
  boldRow,
  continuationRows,
  denseFormStart,
  fixtureDocument,
  fullPageRows,
  otherColumnRows,
  ownHeaderTable,
  pageNumberFooter,
  repeatedHeaderRows,
  row,
  rowsFromPageTop,
  rowsThenTotal,
  tableAtPageBottom,
  tableAtPageTop,
  text,
  threeColumnTableAtPageBottom,
  twoColumnProse,
  twoRowFragment,
  unfinishedParagraph,
} from "./continuation-fixtures.js";
import { bySourceId } from "./conversion-fixtures.js";

async function convert(loaded: LoadedDocument, format: "markdown" | "html" | "text" | "json" = "json", converter = new DocumentConverter()) {
  return converter.convert({ loaded }, { format });
}

const kinds = (result: ConversionResult) => result.pages.map((page) => page.elements.map((element) => element.kind));

function tables(result: ConversionResult): TableElement[] {
  return result.pages.flatMap((page) => page.elements.filter((element): element is TableElement => element.kind === "table"));
}

function paragraphs(elements: readonly DocumentElement[]): ParagraphElement[] {
  return elements.filter((element): element is ParagraphElement => element.kind === "paragraph");
}

const probe = () => fixtureDocument(
  [...tableAtPageBottom, pageNumberFooter(1)],
  [...continuationRows, pageNumberFooter(2)],
);

describe("tables that continue across a page break", () => {
  it("joins the continuation into one table on its starting page", async () => {
    const result = await convert(probe());
    expect(kinds(result)).toEqual([["table", "paragraph", "page-break"], ["paragraph"]]);
    const [table] = tables(result);
    expect(table?.rows).toEqual([["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"], ["Gamma", "30"], ["Delta", "40"], ["Epsilon", "50"]]);
    expect(table?.headerRows).toBe(1);
    expect(table === undefined ? [] : provenanceSegments(table.provenance)).toEqual([
      {
        pageNumber: 1,
        box: { x: 40, y: 640, width: 190, height: 52 },
        sourceIds: ["p1-text-1", "p1-text-2", "p1-text-3"],
        lineIds: ["p1-line-1", "p1-line-2", "p1-line-3"],
      },
      {
        pageNumber: 2,
        box: { x: 40, y: 100, width: 170, height: 52 },
        sourceIds: ["p2-text-1", "p2-text-2", "p2-text-3"],
        lineIds: ["p2-line-1", "p2-line-2", "p2-line-3"],
      },
    ]);
    expect(table?.rowProvenance?.map((segment) => [segment.pageNumber, segment.sourceIds, segment.lineIds])).toEqual([
      [1, ["p1-text-1"], ["p1-line-1"]],
      [1, ["p1-text-2"], ["p1-line-2"]],
      [1, ["p1-text-3"], ["p1-line-3"]],
      [2, ["p2-text-1"], ["p2-line-1"]],
      [2, ["p2-text-2"], ["p2-line-2"]],
      [2, ["p2-text-3"], ["p2-line-3"]],
    ]);
    expect(table?.rowProvenance?.[3]?.box).toEqual({ x: 40, y: 100, width: 170, height: 12 });
    expect(table?.sourceText).toBe("Item Amount\nAlpha 10\nBeta 20\nGamma 30\nDelta 40\nEpsilon 50");
  });

  it("renders the joined table once, before the next page marker", async () => {
    const markdown = await convert(probe(), "markdown");
    expect(markdown.content).toBe([
      "<!-- page: 1 -->",
      "| Item | Amount |\n| --- | --- |\n| Alpha | 10 |\n| Beta | 20 |\n| Gamma | 30 |\n| Delta | 40 |\n| Epsilon | 50 |",
      "Page 1",
      "<!-- page: 2 -->",
      "Page 2",
    ].join("\n\n"));
    const plain = await convert(probe(), "text");
    expect(plain.content).toBe("Item Amount\nAlpha 10\nBeta 20\nGamma 30\nDelta 40\nEpsilon 50\n\nPage 1\fPage 2");
    const html = await convert(probe(), "html");
    expect(html.pages.map((page) => (page.content.match(/<table>/gu) ?? []).length)).toEqual([1, 0]);
  });

  it("drops a repeated header row without losing its source", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, repeatedHeaderRows));
    const [table] = tables(result);
    expect(tables(result)).toHaveLength(1);
    expect(table?.rows).toEqual([["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"], ["Gamma", "30"], ["Delta", "40"], ["Epsilon", "50"]]);
    expect(table?.headerRows).toBe(1);
    expect(table?.sourceText).toBe("Item Amount\nAlpha 10\nBeta 20\nItem Amount\nGamma 30\nDelta 40\nEpsilon 50");
    expect(table?.provenance.continuations?.[0]?.sourceIds).toEqual(["p2-text-1", "p2-text-2", "p2-text-3", "p2-text-4"]);
    expect(table?.rowProvenance?.map((segment) => segment.sourceIds[0])).toEqual([
      "p1-text-1", "p1-text-2", "p1-text-3", "p2-text-2", "p2-text-3", "p2-text-4",
    ]);
    expect(result.pages[1]?.elements).toEqual([]);
  });

  it("joins a two-row continuation that column detection would otherwise split", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, twoRowFragment));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"], ["Gamma", "30"], ["Delta", "40"]],
    ]);
    expect(paragraphs(result.pages[1]?.elements ?? []).map((paragraph) => paragraph.text)).toEqual(["Amounts are in thousands."]);
  });

  it("follows a table across three pages while the middle page holds only its rows", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, fullPageRows, continuationRows));
    const [table] = tables(result);
    expect(tables(result)).toHaveLength(1);
    expect(table?.rows).toHaveLength(36);
    expect(table?.rows[35]).toEqual(["Epsilon", "50"]);
    expect(table === undefined ? [] : provenanceSegments(table.provenance).map((segment) => segment.pageNumber)).toEqual([1, 2, 3]);
    expect(kinds(result)).toEqual([["table", "page-break"], ["page-break"], []]);
  });

  it("drops a bold repeated header printed in the top band", async () => {
    const result = await convert(fixtureDocument(
      [boldRow(640, ["Item", 40], ["Amount", 200]), row(660, ["Alpha", 40], ["10", 200]), row(680, ["Beta", 40], ["20", 200])],
      [boldRow(40, ["Item", 40], ["Amount", 200]), row(100, ["Gamma", 40], ["30", 200]), row(120, ["Delta", 40], ["40", 200])],
    ));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"], ["Gamma", "30"], ["Delta", "40"]],
    ]);
    expect(result.pages[1]?.elements).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("takes continuation rows that start inside the top band of the page", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, rowsFromPageTop));
    expect(tables(result).map((table) => table.rows.length)).toEqual([6]);
    expect(kinds(result)).toEqual([["table", "page-break"], []]);
  });

  it("joins a totals row with fewer cells after the continued rows", async () => {
    const result = await convert(fixtureDocument(threeColumnTableAtPageBottom, rowsThenTotal));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Qty", "Amount"], ["Alpha", "1", "10"], ["Beta", "2", "20"], ["Gamma", "3", "30"], ["", "Total", "60"]],
    ]);
    expect(paragraphs(result.pages[1]?.elements ?? []).map((paragraph) => paragraph.text)).toEqual(["Prices include tax."]);
  });

  it("keeps tables in different columns separate", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, otherColumnRows));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows.length, table.provenance.continuations])).toEqual([
      [1, 3, undefined],
      [2, 3, undefined],
    ]);
  });

  it("does not take two-column prose after a table as table rows", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, twoColumnProse));
    expect(tables(result).map((table) => [table.rows.length, table.provenance.continuations])).toEqual([[3, undefined]]);
    expect(paragraphs(result.pages[1]?.elements ?? [])[0]?.text).toBe(
      "Revenue rose in the north, while costs in the south held steady through the year.",
    );
  });

  it("does not join a different table that starts with its own header", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, ownHeaderTable));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"]],
      [["Code", "Units"], ["A1", "3"], ["B2", "4"]],
    ]);
  });

  it("stops before a line far below the continuation rows", async () => {
    const result = await convert(fixtureDocument(threeColumnTableAtPageBottom, [
      row(100, ["Gamma", 40], ["3", 200], ["30", 300]),
      row(700, ["Approved by", 40], ["2024-03-01", 300]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Qty", "Amount"], ["Alpha", "1", "10"], ["Beta", "2", "20"], ["Gamma", "3", "30"]],
    ]);
    expect(paragraphs(result.pages[1]?.elements ?? []).map((paragraph) => paragraph.text)).toEqual(["Approved by 2024-03-01"]);
  });

  it.each([
    ["an unrelated table without a bold header", tableAtPageBottom, [
      row(100, ["Code", 40], ["Units", 200]), row(120, ["A1", 40], ["3", 200]), row(140, ["B2", 40], ["4", 200]),
    ]],
    ["a key-value block", tableAtPageBottom, [
      row(100, ["Customer: Kestrel Ltd", 40], ["Date: 2024-03-01", 200]),
      row(120, ["Account: 001-22", 40], ["Branch: North", 200]),
    ]],
    ["narrow two-column prose in the table's columns", [
      row(640, ["Region", 40], ["Total", 320]), row(660, ["North", 40], ["10", 320]), row(680, ["South", 40], ["20", 320]),
    ], [
      row(100, ["revenue rose in the north and", 40], ["costs in the south held steady", 320]),
      row(116, ["the west was flat. Exports grew", 40], ["through the year, and imports", 320]),
      row(132, ["again in the final quarter.", 40], ["fell for a second year.", 320]),
    ]],
  ])("does not join %s whose text fills a number column", async (_case, first, second) => {
    const result = await convert(fixtureDocument(first, second));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows.length, table.provenance.continuations])[0]).toEqual([1, 3, undefined]);
  });

  it("ends the join at a bold header that starts another table after the continued rows", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, [
      row(100, ["Gamma", 40], ["30", 200]),
      boldRow(120, ["Code", 40], ["Units", 200]),
      row(140, ["A1", 40], ["3", 200]),
      row(160, ["B2", 40], ["4", 200]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"], ["Gamma", "30"]],
      [["Code", "Units"], ["A1", "3"], ["B2", "4"]],
    ]);
  });

  it("ends the join at a full row whose text fills a number column after the continued rows", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, [
      row(100, ["Gamma", 40], ["30", 200]),
      row(120, ["Customer: Kestrel Ltd", 40], ["Date: 2024-03-01", 200]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"], ["Gamma", "30"]],
    ]);
    expect(paragraphs(result.pages[1]?.elements ?? []).map((paragraph) => paragraph.text)).toEqual([
      "Customer: Kestrel Ltd Date: 2024-03-01",
    ]);
  });

  it("does not join a table that ends above the bottom of its page", async () => {
    const result = await convert(fixtureDocument(tableAtPageTop, continuationRows));
    expect(tables(result).map((table) => [table.provenance.pageNumber, table.rows.length])).toEqual([[1, 3], [2, 3]]);
  });
});

describe("paragraphs cut by a page break", () => {
  it("joins an unfinished paragraph with the lowercase start of the next page", async () => {
    const result = await convert(fixtureDocument(
      [text(100, "Annual summary"), unfinishedParagraph, pageNumberFooter(1)],
      [text(30, "Annual summary"), text(100, "growth to continue next year."), text(120, "Costs were flat."), pageNumberFooter(2)],
    ));
    const joined = paragraphs(result.pages[0]?.elements ?? []).find((paragraph) => paragraph.provenance.sourceIds[0] === "p1-text-2");
    expect(joined?.text).toBe("Revenue grew in every region, and the board expects that\ngrowth to continue next year.");
    expect(joined?.runs).toEqual([
      { text: "Revenue grew in every region, and the board expects that" },
      { text: "\n" },
      { text: "growth to continue next year." },
    ]);
    expect(joined === undefined ? [] : provenanceSegments(joined.provenance)).toEqual([
      { pageNumber: 1, box: { x: 40, y: 690, width: 280, height: 12 }, sourceIds: ["p1-text-2"], lineIds: ["p1-line-2"] },
      { pageNumber: 2, box: { x: 40, y: 100, width: 145, height: 12 }, sourceIds: ["p2-text-2"], lineIds: ["p2-line-2"] },
    ]);
    expect(paragraphs(result.pages[1]?.elements ?? []).map((paragraph) => paragraph.text)).toEqual(["Annual summary", "Costs were flat.", "Page 2"]);
    const markdown = await convert(fixtureDocument([unfinishedParagraph], [text(100, "growth to continue next year.")]), "markdown");
    expect(markdown.content).toBe(
      "<!-- page: 1 -->\n\nRevenue grew in every region, and the board expects that\ngrowth to continue next year.\n\n<!-- page: 2 -->",
    );
  });

  it.each([
    ["a sentence ends before a closing quote", "He said \"the quarter closed.\"", "growth followed."],
    ["a sentence ends before a closing bracket", "Revenue grew (see note 4.)", "growth followed."],
    ["the next page starts with a capital", "Revenue grew in every region, and", "Growth followed."],
    ["the next page uses a script without letter case", "Revenue grew in every region, and", "続きは次の通りです。"],
  ])("keeps paragraphs separate when %s", async (_case, last, first) => {
    const result = await convert(fixtureDocument([text(690, last)], [text(100, first)]));
    expect(result.pages.map((page) => paragraphs(page.elements).map((paragraph) => paragraph.text))).toEqual([[last], [first]]);
  });

  it.each([
    ["the paragraph ends mid-page", 200, 100],
    ["the next page's text starts below its top quarter", 690, 500],
  ])("keeps paragraphs separate when %s", async (_case, endY, startY) => {
    const result = await convert(fixtureDocument(
      [text(endY, "See the appendix for the full list of")],
      [text(startY, "continued remarks follow here.")],
    ));
    expect(result.pages.map((page) => paragraphs(page.elements).map((paragraph) => paragraph.text))).toEqual([
      ["See the appendix for the full list of"],
      ["continued remarks follow here."],
    ]);
  });

  it("reads top-band text that runs on into the body as the page's first paragraph", async () => {
    const result = await convert(fixtureDocument([unfinishedParagraph], denseFormStart));
    expect(result.pages.map((page) => paragraphs(page.elements).length)).toEqual([1, 3]);
    expect(paragraphs(result.pages[0]?.elements ?? [])[0]?.provenance.continuations).toBeUndefined();
  });

  it("keeps text-only pages unchanged", async () => {
    const loaded: LoadedDocument = {
      loader: "text-fixture",
      form: "digital",
      text: "Revenue grew and\fgrowth followed.",
      pages: [
        { pageNumber: 1, width: 0, height: 0, text: "Revenue grew and" },
        { pageNumber: 2, width: 0, height: 0, text: "growth followed." },
      ],
    };
    const result = await convert(loaded);
    expect(result.pages.map((page) => paragraphs(page.elements).map((paragraph) => paragraph.text))).toEqual([
      ["Revenue grew and"],
      ["growth followed."],
    ]);
  });
});

describe("layout analyzers and joined elements", () => {
  function analyzer(annotations: readonly LayoutAnnotation[]) {
    return new DocumentConverter({
      layoutAnalyzer: { name: "fixture", analyze: async ({ document }) => ({ annotations: bySourceId(document, annotations) }) },
    });
  }

  it("keeps a joined table last in its page body and ignores retyping or grouping it", async () => {
    const loaded = fixtureDocument([text(100, "Amounts by item"), ...tableAtPageBottom], continuationRows);
    const result = await convert(loaded, "json", analyzer([
      { id: "p1-text-2", order: 0, role: "paragraph", group: "g" },
      { id: "p1-text-1", order: 1, group: "g" },
      { id: "p1-page-break", order: 2 },
    ]));
    expect(result.warnings).toEqual([]);
    expect(result.pages[0]?.elements.map((element) => [element.provenance.sourceIds, element.kind])).toEqual([
      [["p1-text-1"], "paragraph"],
      [["p1-text-2", "p1-text-3", "p1-text-4"], "table"],
      [[], "page-break"],
    ]);
    expect(tables(result)[0]?.rows).toHaveLength(6);
  });

  it("writes conversion JSON that parses back, with and without annotations", async () => {
    for (const converter of [new DocumentConverter(), analyzer([{ id: "p1-text-1", role: "table" }])]) {
      for (const loaded of [probe(), fixtureDocument(tableAtPageBottom, repeatedHeaderRows), fixtureDocument([unfinishedParagraph], [text(100, "growth followed.")])]) {
        const result = await convert(loaded, "json", converter);
        expect(parseDoctureDocument(JSON.parse(result.content))).toMatchObject({ ok: true, sourceVersion: 2 });
        for (const element of result.pages.flatMap((page) => page.elements)) {
          const segments = [...provenanceSegments(element.provenance), ...(element.kind === "table" ? element.rowProvenance ?? [] : [])];
          for (const segment of segments) {
            const page = loaded.pages.find((candidate) => candidate.pageNumber === segment.pageNumber);
            const known = new Set(page === undefined ? [] : sourceLines(page).map((line) => line.id));
            expect((segment.lineIds ?? []).filter((id) => !known.has(id))).toEqual([]);
          }
        }
      }
    }
  });
});

describe("saved continuation provenance", () => {
  async function saved() {
    const result = await convert(probe());
    return JSON.parse(result.content) as { pages: { elements: Record<string, unknown>[] }[] };
  }

  function issuesOf(document: unknown) {
    const parsed = parseDoctureDocument(document);
    return parsed.ok ? [] : parsed.issues;
  }

  it.each([
    [
      "a row provenance entry is missing",
      (table: Record<string, unknown>) => { table["rowProvenance"] = (table["rowProvenance"] as unknown[]).slice(1); },
      [{ path: "pages.0.elements.0.rowProvenance", message: "must have 6 entries, one per row" }],
    ],
    [
      "a row comes from an earlier page than the row above",
      (table: Record<string, unknown>) => { ((table["rowProvenance"] as Record<string, unknown>[])[4] ?? {})["pageNumber"] = 1; },
      [{ path: "pages.0.elements.0.rowProvenance.4.pageNumber", message: "must not be before page 2 of the row above" }],
    ],
    [
      "a row comes from a page the table does not cover",
      (table: Record<string, unknown>) => { ((table["rowProvenance"] as Record<string, unknown>[])[5] ?? {})["pageNumber"] = 3; },
      [{ path: "pages.0.elements.0.rowProvenance.5.pageNumber", message: "must be one of the table's pages 1, 2" }],
    ],
    [
      "a continuation skips a page",
      (table: Record<string, unknown>) => {
        const provenance = table["provenance"] as { continuations: Record<string, unknown>[] };
        (provenance.continuations[0] ?? {})["pageNumber"] = 3;
      },
      [{ path: "pages.0.elements.0.provenance.continuations.0.pageNumber", message: "must be 2, the page after 1" }],
    ],
    [
      "a continuation names lines of another page",
      (table: Record<string, unknown>) => {
        const provenance = table["provenance"] as { continuations: Record<string, unknown>[] };
        (provenance.continuations[0] ?? {})["lineIds"] = ["p1-line-1"];
      },
      [{ path: "pages.0.elements.0.provenance.continuations.0.lineIds.0", message: "must name a line on page 2" }],
    ],
  ])("rejects saved JSON where %s", async (_case, edit, expected) => {
    const document = await saved();
    edit(document.pages[0]?.elements[0] ?? {});
    expect(issuesOf(document)).toEqual(expected);
  });

  it("rejects continuations on elements other than tables and paragraphs", async () => {
    const document = await saved();
    const pageBreak = document.pages[0]?.elements[2] ?? {};
    const provenance = pageBreak["provenance"] as Record<string, unknown>;
    provenance["continuations"] = [{ pageNumber: 2, box: { x: 0, y: 0, width: 0, height: 0 }, sourceIds: [] }];
    expect(issuesOf(document)).toEqual([
      { path: "pages.0.elements.2.provenance.continuations", message: "is allowed only on tables and paragraphs" },
    ]);
  });

  it("rejects an empty continuation list", async () => {
    const document = await saved();
    const table = document.pages[0]?.elements[0] ?? {};
    (table["provenance"] as Record<string, unknown>)["continuations"] = [];
    expect(issuesOf(document)).toEqual([
      { path: "pages.0.elements.0.provenance.continuations", message: "must have at least 1 item" },
    ]);
  });
});
