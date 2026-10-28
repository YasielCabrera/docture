import { describe, expect, it } from "vitest";
import { chunkDocument, estimateTokens, type ChunkOptions } from "../../src/chunk/index.js";
import { DocumentConverter, parseDoctureDocument, type HeadingElement, type LoadedDocument, type ParagraphElement } from "../../src/core/index.js";
import { continuationRows, fixtureDocument, tableAtPageBottom, text } from "../core/continuation-fixtures.js";
import { regionRows, tableDocument } from "../core/table-span-fixtures.js";
import { headingsDocument } from "./chunk-fixtures.js";

async function convert(loaded: LoadedDocument) {
  return new DocumentConverter().convert({ loaded }, { format: "json" });
}

const threeParagraphs = () => fixtureDocument([text(100, "Alpha"), text(120, "Beta")], [text(100, "Gamma")]);
const characters = (max: number, extra: Partial<ChunkOptions> = {}): ChunkOptions => ({ budget: { unit: "characters", max }, ...extra });

const stockHeading: HeadingElement = {
  id: "stock-heading",
  kind: "heading",
  level: 1,
  text: "Stock",
  runs: [{ text: "Stock" }],
  provenance: { pageNumber: 1, box: { x: 40, y: 600, width: 50, height: 14 }, sourceIds: ["stock-heading"] },
};

describe("chunkDocument", () => {
  it("packs whole elements and keeps the page, box, and source ids behind each chunk", async () => {
    const result = await convert(threeParagraphs());
    const chunks = chunkDocument(result, characters(6));
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(chunks.map((chunk) => chunk.elementIds)).toEqual([["p1-13f6ed79a2ee"], ["p1-0ea25dfd95a9"], ["p2-36609e13aad5"]]);
    expect(chunks.map((chunk) => chunk.provenance)).toEqual([
      [{ pageNumber: 1, box: { x: 40, y: 100, width: 25, height: 12 }, sourceIds: ["p1-text-1"], lineIds: ["p1-line-1"] }],
      [{ pageNumber: 1, box: { x: 40, y: 120, width: 20, height: 12 }, sourceIds: ["p1-text-2"], lineIds: ["p1-line-2"] }],
      [{ pageNumber: 2, box: { x: 40, y: 100, width: 25, height: 12 }, sourceIds: ["p2-text-1"], lineIds: ["p2-line-1"] }],
    ]);
    const merged = chunkDocument(result, characters(100));
    expect(merged.map((chunk) => [chunk.text, chunk.provenance.map((segment) => segment.pageNumber)])).toEqual([
      ["Alpha\n\nBeta\n\nGamma", [1, 1, 2]],
    ]);
  });

  it("gives the same chunk ids when the same document is converted twice", async () => {
    const first = chunkDocument(await convert(threeParagraphs()), characters(6)).map((chunk) => chunk.id);
    const second = chunkDocument(await convert(threeParagraphs()), characters(6)).map((chunk) => chunk.id);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(3);
    expect(first[0]).toMatch(/^chunk-[0-9a-f]{16}$/u);
  });

  it("chunks a saved JSON document like the conversion result it came from", async () => {
    const result = await convert(threeParagraphs());
    const saved = parseDoctureDocument(JSON.parse(result.content));
    if (!saved.ok) throw new Error("saved document did not parse");
    expect(chunkDocument(saved.document, characters(6))).toEqual(chunkDocument(result, characters(6)));
  });

  it("starts a chunk at each heading and can prefix the heading path", async () => {
    const result = await convert(headingsDocument());
    expect(chunkDocument(result, characters(1000)).map((chunk) => chunk.text)).toEqual([
      "# Annual report\n\nRevenue grew.",
      "## Costs\n\nCosts were flat.",
    ]);
    expect(chunkDocument(result, characters(1000, { headingPath: true })).map((chunk) => chunk.text)).toEqual([
      "# Annual report\n\nRevenue grew.",
      "# Annual report\n\n## Costs\n\nCosts were flat.",
    ]);
  });

  it("prefixes only the ancestors of a heading, never its earlier siblings", () => {
    const provenance = { pageNumber: 1, box: { x: 0, y: 0, width: 100, height: 10 }, sourceIds: [] };
    const heading = (id: string, value: string, level: HeadingElement["level"]): HeadingElement =>
      ({ id, kind: "heading", level, text: value, runs: [{ text: value }], provenance });
    const paragraph = (id: string, value: string): ParagraphElement => ({ id, kind: "paragraph", text: value, runs: [{ text: value }], provenance });
    const document = { pages: [{ elements: [
      heading("a", "Company A", 1), paragraph("a-p", "Revenue 10"),
      heading("b", "Company B", 1), paragraph("b-p", "Revenue 20"),
      heading("b1", "Employees", 2), paragraph("b1-p", "Five"),
      heading("b2", "Locations", 2), paragraph("b2-p", "Two"),
    ] }] };
    expect(chunkDocument(document, characters(1000, { headingPath: true })).map((chunk) => chunk.text)).toEqual([
      "# Company A\n\nRevenue 10",
      "# Company B\n\nRevenue 20",
      "# Company B\n\n## Employees\n\nFive",
      "# Company B\n\n## Locations\n\nTwo",
    ]);
  });

  it("splits an oversize table between rows and repeats its header row in every piece", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, continuationRows));
    const chunks = chunkDocument(result, characters(61));
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "| Item | Amount |\n| --- | --- |\n| Alpha | 10 |\n| Beta | 20 |",
      "| Item | Amount |\n| --- | --- |\n| Gamma | 30 |\n| Delta | 40 |",
      "| Item | Amount |\n| --- | --- |\n| Epsilon | 50 |",
    ]);
    expect(chunks.map((chunk) => chunk.elementIds)).toEqual([["p1-010d3a61615a"], ["p1-010d3a61615a"], ["p1-010d3a61615a"]]);
    expect(chunks.map((chunk) => chunk.provenance)).toEqual([
      [{
        pageNumber: 1,
        box: { x: 40, y: 640, width: 190, height: 52 },
        sourceIds: ["p1-text-1", "p1-text-2", "p1-text-3"],
        lineIds: ["p1-line-1", "p1-line-2", "p1-line-3"],
      }],
      [{ pageNumber: 2, box: { x: 40, y: 100, width: 170, height: 32 }, sourceIds: ["p2-text-1", "p2-text-2"], lineIds: ["p2-line-1", "p2-line-2"] }],
      [{ pageNumber: 2, box: { x: 40, y: 140, width: 170, height: 12 }, sourceIds: ["p2-text-3"], lineIds: ["p2-line-3"] }],
    ]);
  });

  it("keeps rows joined by a row span in one piece", async () => {
    const result = await convert(tableDocument(regionRows(30)));
    const chunks = chunkDocument(result, characters(40));
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "| Region | Q1 | Q2 |\n| --- | --- | --- |\n| North | 10 | 20 |\n|  | 11 | 21 |",
      "| Region | Q1 | Q2 |\n| --- | --- | --- |\n| South | 30 | 40 |",
    ]);
  });

  it("repeats whole elements from the previous chunk only when overlap is requested", async () => {
    const result = await convert(threeParagraphs());
    expect(chunkDocument(result, characters(12)).map((chunk) => chunk.text)).toEqual(["Alpha\n\nBeta", "Gamma"]);
    expect(chunkDocument(result, characters(12, { overlapElements: 1 })).map((chunk) => chunk.text)).toEqual([
      "Alpha\n\nBeta",
      "Beta\n\nGamma",
    ]);
  });

  it("drops repeated elements that would take a chunk over the budget", async () => {
    const result = await convert(threeParagraphs());
    expect(chunkDocument(result, characters(6, { overlapElements: 1 })).map((chunk) => chunk.text)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("gives a heading its own chunk when it does not fit with the element after it", async () => {
    const result = await convert(headingsDocument());
    expect(chunkDocument(result, characters(20)).map((chunk) => chunk.text)).toEqual([
      "# Annual report",
      "Revenue grew.",
      "## Costs",
      "Costs were flat.",
    ]);
  });

  it("sizes table pieces with the heading path in front of them", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, continuationRows));
    const [first, ...rest] = result.pages;
    const document = { pages: [{ elements: [stockHeading, ...(first?.elements ?? [])] }, ...rest] };
    expect(chunkDocument(document, characters(61, { headingPath: true })).map((chunk) => chunk.text)).toEqual([
      "# Stock\n\n| Item | Amount |\n| --- | --- |\n| Alpha | 10 |",
      "# Stock\n\n| Item | Amount |\n| --- | --- |\n| Beta | 20 |",
      "# Stock\n\n| Item | Amount |\n| --- | --- |\n| Gamma | 30 |",
      "# Stock\n\n| Item | Amount |\n| --- | --- |\n| Delta | 40 |",
      "# Stock\n\n| Item | Amount |\n| --- | --- |\n| Epsilon | 50 |",
    ]);
  });

  it("gives the same chunk ids whatever the order of the budget fields", async () => {
    const result = await convert(threeParagraphs());
    const ids = (options: ChunkOptions) => chunkDocument(result, options).map((chunk) => chunk.id);
    expect(ids({ budget: { max: 12, unit: "characters" } })).toEqual(ids({ budget: { unit: "characters", max: 12 } }));
  });

  it("measures an estimated-token budget as a quarter of the characters, rounded up", async () => {
    expect(estimateTokens("Alpha")).toBe(2);
    const result = await convert(threeParagraphs());
    const budget = { budget: { unit: "estimatedTokens", max: 3 } } as const;
    expect(chunkDocument(result, budget).map((chunk) => chunk.text)).toEqual(["Alpha\n\nBeta", "Gamma"]);
  });

  it("rejects a budget or overlap it cannot honour", async () => {
    const result = await convert(threeParagraphs());
    expect(() => chunkDocument(result, characters(0))).toThrow(new RangeError("budget.max must be a positive finite number"));
    expect(() => chunkDocument(result, characters(10, { overlapElements: -1 }))).toThrow(
      new RangeError("overlapElements must be a non-negative integer"),
    );
  });
});
