import { expect, it, vi } from "vitest";
import { z } from "zod";
import * as core from "../../src/core/index.js";
import { requestedPageNumbers } from "../../src/core/pipeline/pages.js";
import { PDF_BYTES, fakeLoader, fakeSplitter, fakeStrategy, multiPageDoc, page } from "./fakes.js";

const Simple = z.object({ value: z.string() });
const digital = { ...page(1, "A digital invoice with more than sixty characters of text in its text layer."), image: async () => new Uint8Array([1]) };
const scanned = page(2, "", false);
const mixed: core.LoadedDocument = { pages: [digital, scanned], text: `${digital.text}\f`, loader: "fake", form: "mixed" };
const projected = { pageCount: 1, textLength: 0, hasTextLayer: false, hasGeometry: false, hasRenderablePages: false, form: "scanned" };

it("applies the existing text threshold to a short digital selection", async () => {
  const short = page(2, "A short digital page.");
  const document: core.LoadedDocument = { pages: [digital, short], text: `${digital.text}\f${short.text}`, loader: "fake", form: "digital" };
  const outcome = await core.createExtractor({ loaders: [fakeLoader({ document })], strategies: [fakeStrategy({ requires: ["TEXT_LAYER"] })] })
    .safeExtract(PDF_BYTES, Simple, { pages: [2] });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("Expected ineligible short selection");
  expect(outcome.error).toBeInstanceOf(core.NoEligibleStrategyError);
  if (!(outcome.error instanceof core.NoEligibleStrategyError)) throw outcome.error;
  expect(outcome.error.features).toMatchObject({ pageCount: 1, textLength: 21, hasTextLayer: false, form: "digital" });
});

it("routes only on selected page features", async () => {
  const text = vi.fn();
  const extractor = core.createExtractor({
    loaders: [fakeLoader({ document: mixed })],
    strategies: [fakeStrategy({ name: "text", requires: ["TEXT_LAYER"], onExtract: text }), fakeStrategy({ name: "fallback" })],
  });
  const result = await extractor.extract(PDF_BYTES, Simple, { pages: [2] });
  expect(result.features).toMatchObject(projected);
  expect(result.method).toBe("fallback");
  expect(text).not.toHaveBeenCalled();
});

it("projects preloaded facts and preserves original page numbers", async () => {
  const seen: number[][] = [];
  const result = await core.createExtractor({ loaders: [fakeLoader({ fail: "must not reload" })], strategies: [fakeStrategy({ onExtract: (ctx) => seen.push(ctx.document.pages.map(p => p.pageNumber)) })] })
    .extract({ loaded: mixed, mimeType: "application/pdf", facts: ["CUSTOM"] }, Simple, { pages: [2] });
  expect(result.features).toMatchObject({ ...projected, mimeType: "application/pdf", extra: { CUSTOM: true } });
  expect(seen).toEqual([[2]]);
});

it.each([{ pages: [99] }, { pages: [] }])("rejects invalid page selection $pages with a typed error", async ({ pages }) => {
  const outcome = await core.createExtractor({ loaders: [fakeLoader()], strategies: [fakeStrategy()] })
    .safeExtract(PDF_BYTES, Simple, { pages });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("Expected failed selection");
  expect(outcome.error).toBeInstanceOf(core.PageSelectionError);
  expect(outcome.error).toMatchObject({ code: "PAGE_OUT_OF_RANGE", missingPages: pages, pageCount: 1 });
  expect(outcome.error.message).toContain(pages.length === 0 ? "empty" : "99");
  expect(outcome.error.message).toContain("1");
});

it("gives a scanned Process group its own features", async () => {
  const kind = core.defineClassification({ name: "document", description: "A document", schema: Simple });
  const extractor = new core.Extractor().loadDocumentLoader(fakeLoader({ document: mixed })).loadStrategy(fakeStrategy());
  const results = await new core.Process().loadExtractor(extractor)
    .loadSplitter(fakeSplitter({ eager: [{ pages: [1], classification: "document" }, { pages: [2], classification: "document" }] }))
    .loadFile(PDF_BYTES).split([kind], core.SplittingStrategy.EAGER).extract();
  expect(results[0]?.result.features).toMatchObject({ hasTextLayer: true, hasGeometry: true, hasRenderablePages: true, form: "digital" });
  expect(results[1]?.result.features).toMatchObject(projected);
});

it("blames maxPages, not the document, for a page past the limit", () => {
  const failure = (requested: number[]) => {
    try {
      requestedPageNumbers(10, requested, 3);
      return undefined;
    } catch (error) {
      return core.isDoctureError(error, "PAGE_OUT_OF_RANGE")
        ? { message: error.message, hint: error.hint, missingPages: error.missingPages, pageCount: error.pageCount, maxPages: error.maxPages }
        : error;
    }
  };
  expect(failure([5])).toEqual({
    message: "Page 5 is outside the first 3 pages that maxPages allows. The document has 10 pages.",
    hint: "Select pages within the first maxPages pages, or raise maxPages.",
    missingPages: [5],
    pageCount: 10,
    maxPages: 3,
  });
  expect(failure([0, 2, 11])).toMatchObject({ message: "Pages 0, 11 are outside the first 3 pages that maxPages allows. The document has 10 pages." });
  expect(() => requestedPageNumbers(10, [11], 20)).toThrow("Page 11 does not exist. The document has 10 pages.");
  expect(requestedPageNumbers(10, [3, 1], 3)).toEqual([1, 3]);
});

it("names the loaded pages rather than a document length when a loader returned fewer pages", async () => {
  const firstThree = multiPageDoc(["one", "two", "three"]);
  const outcome = await core.createExtractor({ loaders: [fakeLoader({ document: firstThree })], strategies: [fakeStrategy()] })
    .safeExtract(PDF_BYTES, Simple, { pages: [2, 5, 7] });
  if (outcome.ok) throw new Error("Expected failed selection");
  expect(core.isDoctureError(outcome.error, "PAGE_OUT_OF_RANGE")
    ? { message: outcome.error.message, hint: outcome.error.hint, missingPages: outcome.error.missingPages, loadedPages: outcome.error.loadedPages }
    : outcome.error).toEqual({
    message: "Pages 5, 7 were not loaded. The loaded pages are 1-3.",
    hint: "Select pages among loadedPages. A loader can return fewer pages than the document has, for example under its own page limit.",
    missingPages: [5, 7],
    loadedPages: [1, 2, 3],
  });
});
