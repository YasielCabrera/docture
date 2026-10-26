import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, PageSelectionError, type DocumentLoader } from "../../src/core/index.js";
import { PDF_BYTES, fakeLoader, fakeStrategy, page } from "./fakes.js";

const schema = z.object({ value: z.string() });
const document = {
  loader: "pages", form: "digital" as const,
  pages: [page(1, "first"), page(2, "second"), page(3, "third")],
  text: "first\fsecond\fthird",
};

describe("requested page loading", () => {
  it("forwards original page numbers and still projects loaders that ignore them", async () => {
    let request: unknown;
    let seen: number[] = [];
    const loader: DocumentLoader = {
      ...fakeLoader({ name: "pages" }),
      async load(_raw, ctx) { request = ctx.request; return document; },
    };
    const extractor = createExtractor({
      loaders: [loader],
      strategies: [fakeStrategy({ onExtract(ctx) { seen = ctx.document.pages.map((p) => p.pageNumber); } })],
    });
    const result = await extractor.extract(PDF_BYTES, schema, { pages: [3, 1, 3] });
    expect(request).toEqual({ pages: [3, 1, 3] });
    expect(seen).toEqual([1, 3]);
    expect(result.features.pageCount).toBe(2);
    expect(result.data).toEqual({ value: "ok" });
  });

  it("lets a loader materialize only the selected pages without renumbering them", async () => {
    const read: number[] = [];
    const loader: DocumentLoader = {
      ...fakeLoader({ name: "selective" }),
      async load(_raw, ctx) {
        const requested: unknown = Reflect.get(ctx.request ?? {}, "pages");
        const wanted = Array.isArray(requested) ? new Set(requested) : undefined;
        const pages = document.pages.filter((p) => wanted === undefined || wanted.has(p.pageNumber));
        read.push(...pages.map((p) => p.pageNumber));
        return { ...document, pages, text: pages.map((p) => p.text).join("\f") };
      },
    };
    const result = await createExtractor({ loaders: [loader], strategies: [fakeStrategy()] })
      .extract(PDF_BYTES, schema, { pages: [3] });
    expect(read).toEqual([3]);
    expect(result.features.pageCount).toBe(1);
    expect(result.data).toEqual({ value: "ok" });
  });

  it("preserves typed page-selection errors from an adapter", async () => {
    const loader: DocumentLoader = {
      ...fakeLoader(),
      async load() { throw new PageSelectionError([999], 3); },
    };
    const outcome = await createExtractor({ loaders: [loader], strategies: [fakeStrategy()] })
      .safeExtract(PDF_BYTES, schema, { pages: [1, 999] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatchObject({ code: "PAGE_OUT_OF_RANGE", missingPages: [999], pageCount: 3 });
  });

  it("keeps page validation for preloaded sources", async () => {
    const outcome = await createExtractor({ loaders: [fakeLoader()], strategies: [fakeStrategy()] })
      .safeExtract({ loaded: document }, schema, { pages: [] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatchObject({ code: "PAGE_OUT_OF_RANGE", missingPages: [], pageCount: 3 });
  });
});
