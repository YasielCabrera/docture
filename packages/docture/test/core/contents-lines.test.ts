import { describe, expect, it } from "vitest";
import { DocumentConverter, provenanceSegments, type ConversionResult, type ParagraphElement } from "docture";
import { fixtureDocument, row, text, type FixtureLine } from "./continuation-fixtures.js";

async function convert(first: FixtureLine, second: FixtureLine, format: "json" | "markdown" = "json"): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded: fixtureDocument([first], [second]) }, { format });
}

const paragraphs = (result: ConversionResult): ParagraphElement[][] =>
  result.pages.map((page) => page.elements.filter((element): element is ParagraphElement => element.kind === "paragraph"));

describe("contents entries at a page break", () => {
  it("keeps a dot-leader entry and the next page's lowercase paragraph on their own pages", async () => {
    const result = await convert(text(690, "Contents .......... 7"), text(100, "the next section begins with a fresh paragraph."));
    const [entry, next] = paragraphs(result).map((page) => page[0]);
    expect([entry?.text, next?.text]).toEqual(["Contents .......... 7", "the next section begins with a fresh paragraph."]);
    expect(entry === undefined ? [] : provenanceSegments(entry.provenance)).toEqual([
      { pageNumber: 1, box: { x: 40, y: 690, width: 105, height: 12 }, sourceIds: ["p1-text-1"], lineIds: ["p1-line-1"] },
    ]);
    expect(next === undefined ? [] : provenanceSegments(next.provenance)).toEqual([
      { pageNumber: 2, box: { x: 40, y: 100, width: 235, height: 12 }, sourceIds: ["p2-text-1"], lineIds: ["p2-line-1"] },
    ]);
    expect(result.warnings).toEqual([]);
    const markdown = await convert(text(690, "Contents .......... 7"), text(100, "the next section begins with a fresh paragraph."), "markdown");
    expect(markdown.content).toBe(
      "<!-- page: 1 -->\n\nContents .......... 7\n\n<!-- page: 2 -->\n\nthe next section begins with a fresh paragraph.",
    );
  });

  it.each([
    ["an ellipsis leader", text(690, "Contents … 7"), text(100, "the next section begins.")],
    ["a spaced dot leader", text(690, "Contents . . . . 7"), text(100, "the next section begins.")],
    ["a Roman page number", text(690, "Preface .......... ix"), text(100, "the next section begins.")],
    ["a page number set apart by a wide gap", row(690, ["Introduction", 40], ["7", 500]), text(100, "the next section begins.")],
    ["a contents entry starting the next page", text(690, "Revenue grew in every region, and"), text(100, "introduction .......... 3")],
  ])("keeps paragraphs separate across %s", async (_case, first, second) => {
    const result = await convert(first, second);
    const texts = paragraphs(result).map((page) => page.map((paragraph) => paragraph.text));
    expect(texts).toEqual([[first.cells.map(([value]) => value).join(" ")], [second.cells.map(([value]) => value).join(" ")]]);
    expect(paragraphs(result).flat().map((paragraph) => paragraph.provenance.continuations)).toEqual([undefined, undefined]);
    expect(result.warnings).toEqual([]);
  });
});

describe("contents entries from a loader without page lines", () => {
  it("keeps a page number set apart by a wide gap on its own page", async () => {
    const loaded = fixtureDocument([row(690, ["Introduction", 40], ["7", 500])], [text(100, "the next section begins.")]);
    const result = await new DocumentConverter().convert({
      loaded: { ...loaded, pages: loaded.pages.map(({ lines: _lines, ...page }) => page) },
    }, { format: "json" });
    expect(paragraphs(result).map((page) => page.map((paragraph) => paragraph.text))).toEqual([["Introduction 7"], ["the next section begins."]]);
    expect(result.warnings).toEqual([]);
  });
});

describe("paragraphs that end in numbers at a page break", () => {
  it.each([
    ["an unfinished sentence", text(690, "Revenue grew in every region, and the board expects that"), "growth to continue next year."],
    ["a sentence ending in a year", text(690, "The current lease runs until the end of 2026"), "and renews each year after that."],
    ["a number after an ordinary word gap", row(690, ["Costs rose by", 40], ["7", 108]), "percent across the group."],
    ["ordinary punctuation and numbers", text(690, "Sales reached 1,204 units, up 3.5% on"), "the previous quarter."],
    ["two dots before a number", text(690, "Items 1.. 7"), "were withdrawn."],
    ["a word split by a hyphen", text(690, "The committee will continue the investi-"), "gation next quarter."],
  ])("joins %s with the next page's lowercase start", async (_case, last, first) => {
    const result = await convert(last, text(100, first));
    const [onFirstPage, second] = paragraphs(result);
    const joined = onFirstPage?.[0];
    expect(joined?.text).toBe(`${last.cells.map(([value]) => value).join(" ")}\n${first}`);
    expect(joined === undefined ? [] : provenanceSegments(joined.provenance).map((segment) => segment.sourceIds)).toEqual([["p1-text-1"], ["p2-text-1"]]);
    expect(second).toEqual([]);
  });
});
