import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  PageSelectionError,
  type ConversionResult,
  type DocumentLoader,
  type LoadedDocument,
  type LoadRequest,
  type TableElement,
} from "../../src/core/index.js";
import { continuationRows, fixtureDocument, rowsFromPageTop, tableAtPageBottom, text } from "./continuation-fixtures.js";
import { richDocument } from "./conversion-fixtures.js";

const PDF = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", fileName: "report.pdf" };

const threePages = (): LoadedDocument =>
  fixtureDocument([text(100, "Alpha page one.")], [text(100, "Beta page two.")], [text(100, "Gamma page three.")]);

function spyLoader(document: () => LoadedDocument, requests: (LoadRequest | undefined)[] = []): DocumentLoader {
  return {
    name: "spy",
    capabilities: { text: true, geometry: true, images: true, mimeTypes: ["application/pdf"] },
    async load(_raw, ctx) {
      requests.push(ctx.request === undefined ? undefined : structuredClone(ctx.request));
      return document();
    },
  };
}

function selectiveLoader(document: () => LoadedDocument): DocumentLoader {
  return {
    ...spyLoader(document),
    async load(_raw, ctx) {
      const full = document();
      const wanted = new Set(ctx.request?.pages ?? full.pages.map((page) => page.pageNumber));
      const pages = full.pages.filter((page) => wanted.has(page.pageNumber));
      return { ...full, pages, text: pages.map((page) => page.text).join("\f") };
    },
  };
}

const pageNumbers = (result: ConversionResult) => result.pages.map((page) => page.pageNumber);
const tables = (result: ConversionResult) =>
  result.pages.flatMap((page) => page.elements).filter((element): element is TableElement => element.kind === "table");

describe("converting selected pages", () => {
  it("returns only the selected pages, with their original numbers, in every format", async () => {
    const converter = new DocumentConverter({ loaders: [spyLoader(threePages)] });
    const text = await converter.convert(PDF, { format: "text", pages: [2] });
    expect([pageNumbers(text), text.content]).toEqual([[2], "Beta page two."]);
    const markdown = await converter.convert(PDF, { format: "markdown", pages: [3, 1] });
    expect([pageNumbers(markdown), markdown.content]).toEqual([
      [1, 3],
      "<!-- page: 1 -->\n\nAlpha page one.\n\n<!-- page: 3 -->\n\nGamma page three.",
    ]);
    const html = await converter.convert(PDF, { format: "html", pages: [3] });
    expect(html.pages[0]?.content).toBe('<section id="page-3" data-page-number="3">\n<p>Gamma page three.</p>\n</section>');
    const json = await converter.convert(PDF, { format: "json", pages: [2, 3] });
    expect(JSON.parse(json.content).pages.map((page: { pageNumber: number }) => page.pageNumber)).toEqual([2, 3]);
    expect(json.features.pageCount).toBe(2);
  });

  it("asks the loader for only the selected pages along with the layout and asset hints", async () => {
    const requests: (LoadRequest | undefined)[] = [];
    const converter = new DocumentConverter({ loaders: [spyLoader(threePages, requests)] });
    await converter.convert(PDF, { pages: [3, 1] });
    await converter.convert(PDF, { pages: [2], assets: "omit" });
    await converter.convert(PDF);
    expect(requests).toEqual([
      { pages: [3, 1], layout: true, assets: true },
      { pages: [2], layout: true, assets: false },
      { layout: true, assets: true },
    ]);
  });

  it("gives the same result for a selective loader, a loader that ignores hints, and a preloaded source", async () => {
    const options = { format: "json", pages: [1, 3] } as const;
    const selective = await new DocumentConverter({ loaders: [selectiveLoader(threePages)] }).convert(PDF, options);
    const ignoring = await new DocumentConverter({ loaders: [spyLoader(threePages)] }).convert(PDF, options);
    const preloaded = await new DocumentConverter().convert({ loaded: { ...threePages(), loader: "spy" } }, options);
    expect(ignoring.content).toBe(selective.content);
    expect(preloaded.content).toBe(selective.content);
    expect(pageNumbers(selective)).toEqual([1, 3]);
  });

  it("exports only the assets of selected pages", async () => {
    const converter = new DocumentConverter({ loaders: [spyLoader(richDocument)] });
    expect((await converter.convert(PDF, { pages: [1] })).assets.map((asset) => asset.id)).toEqual(["figure"]);
    expect((await converter.convert(PDF, { pages: [2] })).assets).toEqual([]);
  });

  it.each([
    { pages: [], message: "Page selection is empty. The document has 3 pages." },
    { pages: [0], message: "Pages 0 do not exist. The document has 3 pages." },
    { pages: [1.5], message: "Pages 1.5 do not exist. The document has 3 pages." },
    { pages: [2, 4], message: "Pages 4 do not exist. The document has 3 pages." },
  ])("rejects the selection $pages with PAGE_OUT_OF_RANGE", async ({ pages, message }) => {
    for (const run of [
      () => new DocumentConverter({ loaders: [spyLoader(threePages)] }).convert(PDF, { pages }),
      () => new DocumentConverter().convert({ loaded: threePages() }, { pages }),
    ]) {
      const error = await run().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PageSelectionError);
      expect(error).toMatchObject({ code: "PAGE_OUT_OF_RANGE", message });
    }
  });

  it("keeps the selection a caller passed even if the caller changes the array afterwards", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loader: DocumentLoader = { ...spyLoader(threePages), async load() { await gate; return threePages(); } };
    const converter = new DocumentConverter({ loaders: [loader] });

    const pages = [2];
    const single = converter.convert(PDF, { format: "text", pages });
    const batchPages = [1];
    const batch = converter.convertBatch([PDF, PDF], { format: "text", pages: batchPages, concurrency: 1 });
    const first = batch.next();
    pages[0] = 3;
    batchPages.push(3);
    release();

    expect((await single).content).toBe("Beta page two.");
    const contents: string[] = [];
    const item = await first;
    if (!item.done && item.value.outcome.ok) contents.push(item.value.outcome.result.content);
    for await (const next of batch) if (next.outcome.ok) contents.push(next.outcome.result.content);
    expect(contents).toEqual(["Alpha page one.", "Alpha page one."]);
  });

  it("joins a continued table across consecutive selected pages but not across a gap", async () => {
    const converter = new DocumentConverter({ loaders: [spyLoader(() => fixtureDocument(tableAtPageBottom, continuationRows, rowsFromPageTop))] });
    const shape = (result: ConversionResult) => tables(result).map((table) => [table.provenance.pageNumber, table.rows.length]);
    expect(shape(await converter.convert(PDF, { format: "json", pages: [1, 2] }))).toEqual([[1, 6]]);
    expect(shape(await converter.convert(PDF, { format: "json", pages: [1, 3] }))).toEqual([[1, 3], [3, 3]]);
    expect(shape(await converter.convert(PDF, { format: "json", pages: [2] }))).toEqual([[2, 3]]);
  });

  it("keeps the id and original page number of an element that lies wholly on a selected page", async () => {
    const converter = new DocumentConverter({ loaders: [spyLoader(threePages)] });
    const full = await converter.convert(PDF, { format: "json" });
    const selected = await converter.convert(PDF, { format: "json", pages: [2] });
    const [element] = selected.pages[0]?.elements ?? [];
    expect(element?.id).toBe(full.pages[1]?.elements[0]?.id);
    expect(element?.id).toBe("p2-e1b60b73f7aa");
    expect(element?.provenance.pageNumber).toBe(2);
  });
});
