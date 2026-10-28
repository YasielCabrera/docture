import { describe, expect, it } from "vitest";
import { DocumentConverter, type ConversionResult, type LoadedDocument } from "docture";
import { pageNumberHeader } from "../../src/testing/fixtures/conversion-corpus/page-number-header.js";
import { boldLine, corpusDocument, letter, line, type CorpusLine } from "../../src/testing/fixtures/conversion-corpus/layout.js";

async function convert(loaded: LoadedDocument, format: "json" | "markdown" | "text" = "json"): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded }, { format });
}

const furniture = (result: ConversionResult): (readonly [number, string, string, string])[] =>
  result.pages.flatMap((page) => page.elements.flatMap((element) =>
    element.kind === "page-header" || element.kind === "page-footer"
      ? [[page.pageNumber, element.kind, element.text, element.evidence] as const]
      : []));

const small = (y: number, ...cells: CorpusLine["cells"]): CorpusLine => ({ y, cells, fontSize: 9, height: 9 });

const statement = (top: (pageNumber: number) => readonly CorpusLine[]) => corpusDocument(...[1, 2, 3, 4, 5, 6].map((pageNumber) => ({
  width: 612,
  height: 792,
  lines: [
    ...top(pageNumber),
    small(119.2, ["JOHN TEST", 47.7, 50.5], ["Account Number: 6547", 460.6, 100.5]),
    ...Array.from({ length: 6 }, (_unused, index) => small(200 + index * 30, [`Card purchase ${pageNumber}-${index + 1}`, 48, 220])),
  ],
})));

describe("page numbers printed just below the top margin band", () => {
  it("marks the repeated page-number line as a page header on each page that has it", async () => {
    const result = await convert(pageNumberHeader.loaded);
    expect(furniture(result)).toEqual([2, 3, 4, 5].map((page) => [page, "page-header", `Page ${page} of 6`, "repeated"]));
    expect(result.pages[1]?.elements[0]?.provenance).toEqual({
      pageNumber: 2,
      box: { x: 515, y: 98.5, width: 46, height: 9 },
      sourceIds: ["p2-text-1"],
      lineIds: ["p2-line-1"],
    });
    expect(result.warnings).toEqual([]);
  });

  it("leaves the header out of Markdown and keeps it in TXT", async () => {
    const markdown = await convert(pageNumberHeader.loaded, "markdown");
    expect(markdown.pages.map((page) => page.content.includes(`Page ${page.pageNumber} of 6`))).toEqual([false, false, false, false, false, false]);
    const plain = await convert(pageNumberHeader.loaded, "text");
    expect(plain.pages.map((page) => page.content.split("\n")[0])).toEqual([
      "JOHN TEST Account Number: 6547", "Page 2 of 6", "Page 3 of 6", "Page 4 of 6", "Page 5 of 6", "JOHN TEST Account Number: 6547",
    ]);
  });

  it("keeps a page number at a different height on another page out of the cluster", async () => {
    const result = await convert(statement((page) => [small(page === 6 ? 90 : 98.5, [`Page ${page} of 6`, 515, 46])]));
    expect(furniture(result).map(([page]) => page)).toEqual([1, 2, 3, 4, 5]);
    expect(result.pages[5]?.elements[0]).toMatchObject({ kind: "paragraph", text: "Page 6 of 6" });
  });

  it("keeps a bold numbered heading just below the band as content", async () => {
    const worksheet = corpusDocument(...[1, 2, 3].map((page) => letter(
      boldLine(100, [`Question ${page}`, 40]),
      line(140, [`Give the answer to question ${page}.`, 40]),
    )));
    const result = await convert(worksheet);
    expect(furniture(result)).toEqual([]);
    expect(result.pages.map((page) => page.elements[0]?.kind === "heading" ? page.elements[0].text : undefined))
      .toEqual(["Question 1", "Question 2", "Question 3"]);
    const markdown = await convert(worksheet, "markdown");
    expect(markdown.pages.map((page) => page.content.includes(`Question ${page.pageNumber}`))).toEqual([true, true, true]);
  });

  it.each([
    ["a repeated account line with fixed digits", (_page: number) => [small(98.5, ["Account 6547", 48, 60])]],
    ["a page number on only two pages", (page: number) => page <= 2 ? [small(98.5, [`Page ${page} of 6`, 515, 46])] : []],
    ["a page number with body text right under it", (page: number) => [small(104, [`Page ${page} of 6`, 515, 46])]],
    ["a sentence that names its page", (page: number) => [small(98.5, [`This statement continues on page ${page}.`, 48, 200])]],
    ["a page number that drifts across the page", (page: number) => [small(98.5, [`Page ${page} of 6`, 100 + page * 60, 46])]],
  ])("keeps %s as body text", async (_case, top) => {
    const result = await convert(statement(top));
    expect(furniture(result)).toEqual([]);
  });
});
