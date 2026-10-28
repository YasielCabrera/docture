import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, withRasterizer, type Rasterizer } from "docture";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { mergePartials, mergePartialsWithDiagnostics } from "docture/llm/merge";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const Invoice = z.object({ invoiceNumber: z.string(), total: z.number() });
const pages = ["Invoice INV-1 page one with a total of 100.", "Invoice INV-2 page two with a total of 250."];
const answers = [{ invoiceNumber: "INV-1", total: 100 }, { invoiceNumber: "INV-2", total: 250 }];
const expectedConflicts = [
  { path: "invoiceNumber", values: [{ value: "INV-1", pages: [1] }, { value: "INV-2", pages: [2] }] },
  { path: "total", values: [{ value: 100, pages: [1] }, { value: 250, pages: [2] }] },
];

function stubRasterizer(): Rasterizer {
  return {
    name: "stub-raster",
    formats: ["png"],
    async rasterize(_document, options) {
      return (options.pages ?? [1]).map((pageNumber) => ({
        pageNumber, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, pageNumber]), widthPx: 10, heightPx: 14,
        format: "png" as const, scale: 1,
      }));
    },
  };
}

describe("scalar conflicts", () => {
  it("reports disagreeing values per page from a paginated text extraction", async () => {
    const { model } = mockModel(answers);
    const result = await createExtractor({
      loaders: [inMemoryLoader(loadedDocument(pages))],
      strategies: [llm({ model, completion: "paginate", concurrency: 1 })],
    }).extract(new Uint8Array([1]), Invoice);

    expect(result.data).toEqual({ invoiceNumber: "INV-1", total: 100 });
    expect(result.conflicts).toEqual(expectedConflicts);
    expect(result.validation).toEqual({ valid: true, issues: [] });
  });

  it("reports the same conflicts from a per-page vision extraction", async () => {
    const { model } = mockModel(answers);
    const result = await createExtractor({
      loaders: [withRasterizer(inMemoryLoader(loadedDocument(pages)), stubRasterizer())],
      strategies: [vision({ model, pageMode: "perPage", concurrency: 1 })],
    }).extract(new Uint8Array([1]), Invoice);

    expect(result.data).toEqual({ invoiceNumber: "INV-1", total: 100 });
    expect(result.conflicts).toEqual(expectedConflicts);
  });

  it("keeps the extraction's conflicts when a repair replaces the merged answer", async () => {
    const { model, calls } = mockModel([...answers, { invoiceNumber: "INV-1", total: 350 }]);
    const result = await createExtractor({
      loaders: [inMemoryLoader(loadedDocument(pages))],
      strategies: [llm({ model, completion: "paginate", concurrency: 1 })],
    }).extract(new Uint8Array([1]), Invoice, {
      onRuleFailure: "fail",
      rules: [(data) => data.total === 350 ? [] : [{ path: "total", message: "Sum mismatch" }]],
    });

    expect(calls).toHaveLength(3);
    expect(result.attempts.map((attempt) => [attempt.stage, attempt.status])).toEqual([["extract", "failed"], ["repair", "ok"]]);
    expect(result.data).toEqual({ invoiceNumber: "INV-1", total: 350 });
    expect(result.conflicts).toEqual(expectedConflicts);
  });

  it("omits conflicts when the pages agree", async () => {
    const { model } = mockModel([{ invoiceNumber: "INV-1", total: 100 }, { invoiceNumber: " INV-1 ", total: 100.0 }]);
    const result = await createExtractor({
      loaders: [inMemoryLoader(loadedDocument(pages))],
      strategies: [llm({ model, completion: "paginate", concurrency: 1 })],
    }).extract(new Uint8Array([1]), Invoice);

    expect(result.data).toEqual({ invoiceNumber: "INV-1", total: 100 });
    expect("conflicts" in result).toBe(false);
  });

  it("keeps the zero and false presence rule while reporting both values", () => {
    expect(mergePartialsWithDiagnostics([{ data: { total: 0 }, pages: [1] }, { data: { total: 5 }, pages: [2] }])).toEqual({
      data: { total: 5 },
      conflicts: [{ path: "total", values: [{ value: 0, pages: [1] }, { value: 5, pages: [2] }] }],
    });
    expect(mergePartialsWithDiagnostics([{ data: { paid: false }, pages: [1] }, { data: { paid: true }, pages: [2] }])).toEqual({
      data: { paid: true },
      conflicts: [{ path: "paid", values: [{ value: false, pages: [1] }, { value: true, pages: [2] }] }],
    });
  });

  it("treats equal numbers, trimmed strings, nulls and blanks as agreement", () => {
    expect(mergePartialsWithDiagnostics([
      { data: { name: "Acme", total: 10, note: null, code: "" }, pages: [1] },
      { data: { name: "  Acme ", total: 10, note: "late", code: "   " }, pages: [2] },
      { data: { name: "Acme", total: 10 }, pages: [3] },
    ])).toEqual({ data: { name: "Acme", total: 10, note: "late", code: "" }, conflicts: [] });
  });

  it("reports nested paths and collects every page that gave each value", () => {
    expect(mergePartialsWithDiagnostics([
      { data: { vendor: { city: "Paris" } }, pages: [1] },
      { data: { vendor: { city: "Lyon" } }, pages: [2, 3] },
      { data: { vendor: { city: "Paris" } }, pages: [4] },
    ]).conflicts).toEqual([
      { path: "vendor.city", values: [{ value: "Paris", pages: [1, 4] }, { value: "Lyon", pages: [2, 3] }] },
    ]);
  });

  it("treats concatenated array rows as distinct records, not conflicts", () => {
    expect(mergePartialsWithDiagnostics([
      { data: { lines: [{ amount: 1 }] }, pages: [1] },
      { data: { lines: [{ amount: 2 }] }, pages: [2] },
    ])).toEqual({ data: { lines: [{ amount: 1 }, { amount: 2 }] }, conflicts: [] });
  });

  it("reports a scalar and an object or array at the same path, keeping the first", () => {
    expect(mergePartialsWithDiagnostics([
      { data: { vendor: "ACME", tags: ["a"] }, pages: [1] },
      { data: { vendor: { name: "Other" }, tags: "b" }, pages: [2] },
      { data: { vendor: { name: "Other" } }, pages: [3] },
    ])).toEqual({
      data: { vendor: "ACME", tags: ["a"] },
      conflicts: [
        { path: "vendor", values: [{ value: "ACME", pages: [1] }, { value: { name: "Other" }, pages: [2, 3] }] },
        { path: "tags", values: [{ value: ["a"], pages: [1] }, { value: "b", pages: [2] }] },
      ],
    });
    expect(mergePartialsWithDiagnostics([
      { data: { vendor: { name: "Acme" } }, pages: [1] },
      { data: { vendor: "Other" }, pages: [2] },
    ]).conflicts).toEqual([
      { path: "vendor", values: [{ value: { name: "Acme" }, pages: [1] }, { value: "Other", pages: [2] }] },
    ]);
  });

  it("keeps mergePartials data-only over the same fold", () => {
    expect(mergePartials([{ total: 0 }, { total: 5, currency: "EUR" }, { currency: "USD" }])).toEqual({ total: 5, currency: "EUR" });
    expect(mergePartials([])).toBeUndefined();
  });
});
