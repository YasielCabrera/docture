import { describe, expect, it, vi } from "vitest";
import { createExtractor, silentLogger, type LoadRequest, type RasterOptions, type Rasterizer } from "docture";
import { z } from "zod";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentLoaderMuPdf, MuPdfRasterizer } from "docture/loaders/mupdf";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
import { makeInvoicePdf } from "docture/testing/fixtures";

const recognized = vi.hoisted(() => [] as number[]);
vi.mock("../../src/loaders/tesseract/tesseract.js", () => ({
  TesseractPool: class {
    async recognize(bytes: Uint8Array) { recognized.push(bytes[0] ?? 0); return { words: [], confidence: 1 }; }
    async terminate() {}
  },
}));
vi.mock("../../src/loaders/paddleocr/paddle.js", () => ({
  PaddleEngine: class {
    async recognizeAll(images: readonly Uint8Array[]) { recognized.push(...images.map((bytes) => bytes[0] ?? 0)); return images.map(() => ({ regions: [], confidence: 1 })); }
    async destroy() {}
  },
}));

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const badSelections = [[], [0], [1.5], [NaN], [Infinity], [999]];

describe.each([
  ["Tesseract with PDF.js", DocumentLoaderTesseract, NapiCanvasRasterizer],
  ["Tesseract with MuPDF", DocumentLoaderTesseract, MuPdfRasterizer],
  ["PaddleOCR with PDF.js", DocumentLoaderPaddleOcr, NapiCanvasRasterizer],
  ["PaddleOCR with MuPDF", DocumentLoaderPaddleOcr, MuPdfRasterizer],
] as const)("%s selected extraction", (_name, Loader, Renderer) => {
  it("preserves page errors through the public extraction boundary", async () => {
    const fixture = await makeInvoicePdf({ seed: 915 });
    for (const pages of [...badSelections, [1, 999]]) {
      const extractor = createExtractor({ loaders: [new Loader({ rasterizer: new Renderer() })] });
      try {
        const result = await extractor.safeExtract(fixture.bytes, z.object({}), { pages });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
      } finally {
        await extractor.dispose();
      }
    }
  });
});

describe.each([
  ["PDF.js", DocumentLoaderPdfJs],
  ["MuPDF", DocumentLoaderMuPdf],
] as const)("%s selected loading", (_name, Loader) => {
  it("reads only requested original pages in document order", async () => {
    const pdf = await makeInvoicePdf({ seed: 961, lineItemCount: 90 });
    const document = await new Loader().load({ bytes: pdf.bytes, mimeType: "application/pdf" }, { ...ctx, request: { pages: [3, 1, 3] } });
    expect(document.pages.map((page) => page.pageNumber)).toEqual([1, 3]);
    expect(document.meta).toMatchObject({ pageCount: pdf.pageCount, pagesRead: 2 });
  });

  it("rejects invalid requests and requests outside the original page cap", async () => {
    const pdf = await makeInvoicePdf({ seed: 962 });
    for (const pages of badSelections) {
      const error = await new Loader().load({ bytes: pdf.bytes, mimeType: "application/pdf" }, { ...ctx, request: { pages } }).then(() => null, (error: unknown) => error);
      expect(error).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
    }
    const multiPage = await makeInvoicePdf({ seed: 962, lineItemCount: 90 });
    const capped = await new Loader({ maxPages: 1 }).load({ bytes: multiPage.bytes, mimeType: "application/pdf" }, { ...ctx, request: { pages: [2] } }).then(() => null, (error: unknown) => error);
    expect(capped).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
  });
});

describe.each([
  ["PDF.js", NapiCanvasRasterizer],
  ["MuPDF", MuPdfRasterizer],
] as const)("%s selected rasterization", (_name, Rasterizer) => {
  it("sorts and deduplicates requested pages", async () => {
    const pdf = await makeInvoicePdf({ seed: 963, lineItemCount: 90 });
    const pages = await new Rasterizer().rasterize({ bytes: pdf.bytes, mimeType: "application/pdf" }, { pages: [3, 1, 3], dpi: 20 }, ctx);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 3]);
  });

  it("types invalid selected raster pages as page-selection errors", async () => {
    const pdf = await makeInvoicePdf({ seed: 964 });
    for (const pages of badSelections) {
      const error = await new Rasterizer().rasterize({ bytes: pdf.bytes, mimeType: "application/pdf" }, { pages, dpi: 20 }, ctx).then(() => null, (error: unknown) => error);
      expect(error).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
    }
  });
});

describe.each([
  ["Tesseract", DocumentLoaderTesseract],
  ["PaddleOCR", DocumentLoaderPaddleOcr],
] as const)("%s selected recognition", (_name, Loader) => {
  const raw = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" };
  it("forwards selection and filters an ignoring rasterizer before recognition", async () => {
    recognized.length = 0;
    const calls: (RasterOptions | undefined)[] = [];
    const rasterizer: Rasterizer = {
      name: "ignores-selection", formats: ["png"],
      async rasterize(_raw, options) {
        calls.push(options);
        return [3, 1, 2].map((pageNumber) => ({ pageNumber, bytes: new Uint8Array([pageNumber]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }));
      },
    };
    const loader = new Loader({ rasterizer });
    const document = await loader.load(raw, { ...ctx, request: { pages: [3, 1, 3] } });
    expect(calls[0]?.pages).toEqual([3, 1, 3]);
    expect(document.pages.map((page) => page.pageNumber)).toEqual([1, 3]);
    expect([...recognized].sort()).toEqual([1, 3]);
    expect(document.meta).not.toHaveProperty("pageCount");
    await loader.dispose();
  });

  it("rejects invalid selections before recognizing unwanted pages", async () => {
    recognized.length = 0;
    const rasterizer: Rasterizer = {
      name: "three-pages", formats: ["png"],
      async rasterize() { return [1, 2, 3].map((pageNumber) => ({ pageNumber, bytes: new Uint8Array([pageNumber]), widthPx: 1, heightPx: 1, scale: 1, format: "png" })); },
    };
    const requests: LoadRequest[] = [...badSelections.map((pages) => ({ pages })), { pages: [3] }];
    for (const request of requests) {
      const loader = new Loader({ rasterizer, maxPages: 2 });
      const error = await loader.load(raw, { ...ctx, request }).then(() => null, (error: unknown) => error);
      await loader.dispose();
      expect(error).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
    }
    expect(recognized).toEqual([]);
  });
});
