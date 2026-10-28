import { describe, expect, it, vi } from "vitest";
import { createDisposalScope, silentLogger, type DocumentLoader, type LoadedDocument, type LoadedPage, type RawDocument, type LoadContext } from "docture";
import { withOcrFallback } from "../../src/core/contracts/ocr-fallback.js";
import { documentFeatures } from "../../src/core/pipeline/features.js";
import { sourceLines } from "../../src/core/conversion/source-lines.js";

const raw = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" };
const ctx = () => ({ signal: new AbortController().signal, logger: silentLogger });
const page = (pageNumber: number, text: string): LoadedPage => ({ pageNumber, width: 612, height: 792, text });
const doc = (pages: readonly LoadedPage[], loader: string): LoadedDocument => ({ pages, text: pages.map((page) => page.text).join("\f"), form: "mixed", loader });
const capabilities = { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"], facts: ["SHARED_FACT"] } as const;
const quality = (page: LoadedPage) => page.pageNumber === 3 ? { kind: "intentional-blank" as const } : { kind: "text" as const, quality: page.text.trim().length };

describe("selected-page OCR composition", () => {
  it("recovers only low-quality selected pages while preserving intentional blanks and real evidence", async () => {
    const image = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
    const primaryPages = [page(1, "A good digital page with enough text"), { ...page(2, ""), image }, page(3, ""), page(4, "x")];
    const recovered: LoadedPage = { ...page(2, "Recovered scanned page"), lines: [{ y: 10, height: 12, text: "Recovered scanned page", spans: [{ text: "Recovered", x: 5, y: 10, width: 40, height: 12, confidence: 0.9 }, { text: "scanned", x: 50, y: 10, width: 35, height: 12, confidence: 0.8 }, { text: "page", x: 90, y: 10, width: 25, height: 12, confidence: 0.95 }] }], blocks: [{ id: "original-ocr-id", kind: "text", x: 5, y: 10, width: 110, height: 12, lines: [] }] };
    const primary: DocumentLoader = { name: "primary", capabilities, load: vi.fn(async () => doc(primaryPages, "primary")) };
    const recognize = vi.fn(async (_raw: RawDocument, context: LoadContext) => {
      if (context.request?.pages?.[0] === 4) throw new Error("page-specific OCR failed");
      return doc([recovered], "ocr");
    });
    const ocr: DocumentLoader = { name: "ocr", capabilities: { ...capabilities, facts: ["SHARED_FACT", "OCR_ONLY"] }, load: recognize };
    const loader = withOcrFallback(primary, ocr, { assess: quality, threshold: 10 });
    const loaded = await loader.load(raw, ctx());
    expect(recognize.mock.calls.map(([, context]) => context.request?.pages)).toEqual([[2], [4]]);
    expect(loaded.pages[0]).toBe(primaryPages[0]);
    expect(loaded.pages[2]).toBe(primaryPages[2]);
    expect(loaded.pages[3]).toBe(primaryPages[3]);
    expect(loaded.pages[1]?.lines).toBe(recovered.lines);
    expect(loaded.pages[1]?.blocks).toBe(recovered.blocks);
    expect(loaded.pages[1]?.image).toBe(image);
    expect(loaded.pages[1]).toMatchObject({ pageNumber: 2, width: 612, height: 792 });
    expect(sourceLines(loaded.pages[1]!)).toMatchObject([{ id: "p2-line-1", pageNumber: 2, text: "Recovered scanned page" }]);
    expect(loaded.text).toBe("A good digital page with enough text\fRecovered scanned page\f\fx");
    expect(loaded.form).toBe("mixed");
    expect(loader.capabilities.facts).toEqual(["SHARED_FACT"]);
    expect(documentFeatures(loaded, loader, raw.mimeType)).toMatchObject({ hasTextLayer: true, hasGeometry: true, hasRenderablePages: true, extra: { SHARED_FACT: true } });
    expect(loaded.meta?.["ocrFallback"]).toMatchObject({ requestedPages: [2, 4], externalCost: "not-reported", warnings: [{ pageNumber: 4, code: "OCR_FAILED" }], pages: [{ pageNumber: 1, supplier: "primary" }, { pageNumber: 2, supplier: "ocr" }, { pageNumber: 3, supplier: "primary" }, { pageNumber: 4, supplier: "primary" }] });
  });

  it("intersects noncontiguous selection even when custom loaders ignore page hints", async () => {
    const primary: DocumentLoader = { name: "primary", capabilities, load: async () => doc([page(1, ""), page(2, ""), page(3, ""), page(4, "")], "primary") };
    const recognize = vi.fn(async (_raw: RawDocument, _context: LoadContext) => doc([page(1, "other"), page(2, "Recovered second page with sufficient text"), page(3, "other"), page(4, "Recovered fourth page with sufficient text")], "ocr"));
    const loaded = await withOcrFallback(primary, { name: "ocr", capabilities, load: recognize }, { assess: quality, threshold: 10 }).load(raw, { ...ctx(), request: { pages: [4, 2] } });
    expect(recognize.mock.calls.map(([, context]) => context.request?.pages)).toEqual([[2], [4]]);
    expect(loaded.pages.map((page) => page.pageNumber)).toEqual([2, 4]);
    expect(loaded.text).toBe("Recovered second page with sufficient text\fRecovered fourth page with sufficient text");
    expect(loaded.form).toBe("digital");
  });

  it.each(["no-improvement", "missing-page", "geometry-mismatch"])("preserves original text on %s", async (failure) => {
    const original = page(2, "partial");
    const primary: DocumentLoader = { name: "primary", capabilities, load: async () => doc([original], "primary") };
    const replacement = failure === "missing-page" ? page(1, "A recovered page") : failure === "geometry-mismatch" ? { ...page(2, "A recovered page"), width: 100 } : page(2, "partial");
    const ocr: DocumentLoader = { name: "ocr", capabilities, load: async () => doc([replacement], "ocr") };
    const loaded = await withOcrFallback(primary, ocr, { assess: quality, threshold: 10 }).load(raw, ctx());
    expect(loaded.pages).toEqual([original]);
    expect(loaded.meta?.["ocrFallback"]).toMatchObject({ warnings: [{ pageNumber: 2, code: failure === "no-improvement" ? "NO_IMPROVEMENT" : failure === "missing-page" ? "OCR_PAGE_MISSING" : "GEOMETRY_MISMATCH" }] });
  });

  it("propagates abort and disposes shared frozen inputs exactly once through the caller scope", async () => {
    const controller = new AbortController(); const reason = new Error("cancel fallback");
    const dispose = vi.fn(async () => {});
    const shared: DocumentLoader = Object.freeze({ name: "shared", capabilities, dispose, load: async () => { controller.abort(reason); throw reason; } });
    const loader = withOcrFallback(shared, shared, { assess: quality, threshold: 10 });
    await expect(loader.load(raw, { signal: controller.signal, logger: silentLogger })).rejects.toBe(reason);
    const scope = createDisposalScope();
    await scope.dispose(loader, shared);
    await loader.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
