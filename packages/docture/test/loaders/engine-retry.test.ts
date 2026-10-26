import { afterEach, describe, expect, it, vi } from "vitest";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { silentLogger, type DocumentLoader, type Rasterizer } from "docture";

vi.mock("tesseract.js", () => ({
  async createWorker() {
    return {
      async setParameters() {},
      async recognize() { return { data: { text: "", confidence: 100, blocks: null } }; },
      async terminate() {},
    };
  },
}));
vi.mock("ppu-paddle-ocr", () => ({
  PaddleOcrService: class {
    async initialize() {}
    async batchRecognize(images: readonly ArrayBuffer[]) { return images.map(() => ({ text: "", confidence: 1, results: [] })); }
    async destroy() {}
  },
}));

afterEach(() => { vi.doUnmock("../../src/core/engines.js"); vi.resetModules(); });

describe("lazy engine recovery", () => {
  it.each(["pdfjs", "mupdf", "canvas", "tesseract", "paddleocr"])("retries %s initialization and shares concurrent calls", async (engine) => {
    vi.resetModules();
    let attempts = 0;
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    vi.doMock("../../src/core/engines.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/core/engines.js")>();
      return {
        ...actual,
        async importEngine<T>(entry: string, engines: readonly import("../../src/core/engines.js").Engine[], load: () => Promise<T>) {
          attempts++;
          if (attempts === 1) throw Error("transient initialization failure");
          entered.resolve();
          await finish.promise;
          return actual.importEngine(entry, engines, load);
        },
      };
    });
    const pdf = await makeInvoicePdf({ seed: 914 });
    const ctx = { signal: new AbortController().signal, logger: silentLogger };
    const raw = { bytes: pdf.bytes, mimeType: "application/pdf" };
    let loader: DocumentLoader | undefined;
    let operation: () => Promise<number>;
    if (engine === "canvas") {
      const { NapiCanvasRasterizer } = await import("../../src/raster/canvas/index.js");
      operation = async () => (await new NapiCanvasRasterizer().rasterize(raw, { dpi: 36 }, ctx)).length;
    } else {
      const rasterizer: Rasterizer = {
        name: "image", formats: ["png"],
        async rasterize() { return [{ pageNumber: 1, bytes: new Uint8Array([1]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }]; },
      };
      if (engine === "pdfjs") loader = new (await import("../../src/loaders/pdfjs/index.js")).DocumentLoaderPdfJs();
      if (engine === "mupdf") loader = new (await import("../../src/loaders/mupdf/index.js")).DocumentLoaderMuPdf();
      if (engine === "tesseract") loader = new (await import("../../src/loaders/tesseract/index.js")).DocumentLoaderTesseract({ rasterizer, concurrency: 2 });
      if (engine === "paddleocr") loader = new (await import("../../src/loaders/paddleocr/index.js")).DocumentLoaderPaddleOcr({ rasterizer });
      const selected = loader;
      if (selected === undefined) throw Error("Missing loader fixture");
      operation = async () => (await selected.load(raw, ctx)).pages.length;
    }
    await expect(operation()).rejects.toThrow("transient initialization failure");
    const second = operation().catch(() => null);
    const concurrent = operation().catch(() => null);
    await Promise.race([entered.promise, Promise.all([second, concurrent])]);
    finish.resolve();
    expect(await second).toBe(1);
    expect(await concurrent).toBe(1);
    expect(attempts).toBe(2);
    expect(await operation()).toBe(1);
    expect(attempts).toBe(2);
    await loader?.dispose?.();
  });
});
