import { describe, expect, it, vi } from "vitest";
import { PageSelectionError, silentLogger, withRasterizer, type RasterOptions, type Rasterizer } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { MuPdfRasterizer } from "docture/loaders/mupdf";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
import { makeInvoicePdf } from "docture/testing/fixtures";

const recognized = vi.hoisted(() => [] as number[]);
vi.mock("../../src/loaders/tesseract/tesseract.js", () => ({
  TesseractPool: class {
    async recognize(bytes: Uint8Array) {
      recognized.push(bytes[0] ?? 0);
      return { words: [], confidence: 1 };
    }
    async terminate() {}
  },
}));
vi.mock("../../src/loaders/paddleocr/paddle.js", () => ({
  PaddleEngine: class {
    async recognizeAll(images: readonly Uint8Array[]) {
      recognized.push(...images.map((bytes) => bytes[0] ?? 0));
      return images.map(() => ({ regions: [], confidence: 1 }));
    }
    async destroy() {}
  },
}));

const ctx = { signal: new AbortController().signal, logger: silentLogger };

describe.each([
  ["PDF.js", NapiCanvasRasterizer],
  ["MuPDF", MuPdfRasterizer],
] as const)("%s rendering cap", (_name, Renderer) => {
  it("renders only original pages inside the cap and accepts a cap above the page count", async () => {
    const fixture = await makeInvoicePdf({ seed: 1611, lineItemCount: 90 });
    const raw = { bytes: fixture.bytes, mimeType: "application/pdf" };
    const renderer = new Renderer();
    const capped = await renderer.rasterize(raw, { maxPages: 1, dpi: 20 }, ctx);
    expect(capped.map((page) => page.pageNumber)).toEqual([1]);
    const short = await makeInvoicePdf({ seed: 1612 });
    const complete = await renderer.rasterize({ bytes: short.bytes, mimeType: "application/pdf" }, { maxPages: 100, dpi: 20 }, ctx);
    expect(complete.map((page) => page.pageNumber)).toEqual([1]);
  });

  it("keeps selected page numbers and rejects a requested page outside the cap", async () => {
    const fixture = await makeInvoicePdf({ seed: 1613, lineItemCount: 90 });
    const raw = { bytes: fixture.bytes, mimeType: "application/pdf" };
    const renderer = new Renderer();
    const selected = await renderer.rasterize(raw, { pages: [2, 1, 2], maxPages: 2, dpi: 20 }, ctx);
    expect(selected.map((page) => page.pageNumber)).toEqual([1, 2]);
    const outside = await renderer.rasterize(raw, { pages: [3], maxPages: 2, dpi: 20 }, ctx)
      .then(() => null, (error: unknown) => error);
    expect(outside).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
  });
});

it("does not reuse a page image cached with a different page cap", async () => {
  const calls: RasterOptions[] = [];
  const rasterizer: Rasterizer = {
    name: "capped-images", formats: ["png"],
    async rasterize(_raw, options) {
      calls.push(options);
      const pageNumber = options.pages?.[0] ?? 1;
      if (pageNumber > (options.maxPages ?? Infinity)) throw new PageSelectionError([pageNumber], 2);
      return [{ pageNumber, bytes: new Uint8Array([pageNumber]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }];
    },
  };
  const loader = withRasterizer(inMemoryLoader(loadedDocument(["one", "two"])), rasterizer);
  try {
    const document = await loader.load({ bytes: new Uint8Array([1]), mimeType: "application/pdf" }, ctx);
    const image = document.pages[1]?.image;
    if (image === undefined) throw new Error("Composed loader did not expose the second page image.");
    expect([...(await image({ maxPages: 2 }))]).toEqual([2]);
    const outside = await image({ maxPages: 1 }).then(() => null, (error: unknown) => error);
    expect(outside).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
    expect(calls).toEqual([{ maxPages: 2, pages: [2] }, { maxPages: 1, pages: [2] }]);
    expect([...(await image({ maxPages: 2 }))]).toEqual([2]);
    expect(calls).toHaveLength(2);
  } finally {
    await loader.dispose();
  }
});

describe.each([
  ["Tesseract", DocumentLoaderTesseract],
  ["PaddleOCR", DocumentLoaderPaddleOcr],
] as const)("%s capped recognition", (_name, Loader) => {
  it("forwards the page cap before rendering and recognizes no unwanted pages", async () => {
    recognized.length = 0;
    const calls: RasterOptions[] = [];
    const rasterizer: Rasterizer = {
      name: "records-cap", formats: ["png"],
      async rasterize(_raw, options) {
        calls.push(options);
        return [1, 2, 3].map((pageNumber) => ({
          pageNumber, bytes: new Uint8Array([pageNumber]), widthPx: 1, heightPx: 1, scale: 1, format: "png",
        }));
      },
    };
    const loader = new Loader({ rasterizer, maxPages: 1 });
    try {
      const document = await loader.load({ bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" }, ctx);
      expect(calls).toEqual([{ dpi: 300, format: "png", maxPages: 1 }]);
      expect(document.pages.map((page) => page.pageNumber)).toEqual([1]);
      expect(recognized).toEqual([1]);
      expect(document.meta).toMatchObject({ pagesRead: 1 });
      expect(document.meta).not.toHaveProperty("pageCount");
    } finally {
      await loader.dispose();
    }
  });

  it("forwards selection with the cap and retains original page numbers", async () => {
    recognized.length = 0;
    const calls: RasterOptions[] = [];
    const rasterizer: Rasterizer = {
      name: "selected-cap", formats: ["png"],
      async rasterize(_raw, options) {
        calls.push(options);
        return [{ pageNumber: 2, bytes: new Uint8Array([2]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }];
      },
    };
    const loader = new Loader({ rasterizer, maxPages: 2 });
    try {
      const document = await loader.load({ bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" }, { ...ctx, request: { pages: [2] } });
      expect(calls).toEqual([{ dpi: 300, format: "png", pages: [2], maxPages: 2 }]);
      expect(document.pages.map((page) => page.pageNumber)).toEqual([2]);
      expect(recognized).toEqual([2]);
    } finally {
      await loader.dispose();
    }
  });
});
