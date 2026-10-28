import { describe, expect, it } from "vitest";
import { silentLogger, type DocumentLoader, type Rasterizer } from "docture";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { DocumentLoaderTesseract } from "../../src/loaders/tesseract/index.js";
import { DocumentLoaderPaddleOcr } from "../../src/loaders/paddleocr/index.js";

const RUN_OCR = process.env["RUN_OCR"] === "1" || process.env["RUN_OCR"] === "true";
const ctx = { signal: new AbortController().signal, logger: silentLogger };

function recordingRasterizer() {
  const canvas = new NapiCanvasRasterizer();
  const signals: AbortSignal[] = [];
  const rasterizer: Rasterizer = {
    name: canvas.name,
    formats: canvas.formats,
    rasterize(document, options, renderCtx) {
      signals.push(renderCtx.signal);
      return canvas.rasterize(document, options, renderCtx);
    },
  };
  return { rasterizer, signals };
}

const loaders: readonly [string, (rasterizer: Rasterizer) => DocumentLoader & { dispose(): Promise<void> }][] = [
  ["DocumentLoaderTesseract", (rasterizer) => new DocumentLoaderTesseract({ rasterizer, dpi: 100 })],
  ["DocumentLoaderPaddleOcr", (rasterizer) => new DocumentLoaderPaddleOcr({ rasterizer, dpi: 100 })],
];

describe.runIf(RUN_OCR).each(loaders)("%s page images", (_name, create) => {
  it("cancels a page render for an aborted call and renders again for a live one", async () => {
    const { rasterizer, signals } = recordingRasterizer();
    const loader = create(rasterizer);
    const pdf = await makeInvoicePdf({ seed: 411 });
    try {
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);
      const page = document.pages[0]!;
      const caller = new AbortController();
      const reason = new DOMException("caller stopped", "AbortError");

      const aborted = page.image!({ dpi: 72 }, { signal: caller.signal });
      caller.abort(reason);
      await expect(aborted).rejects.toBe(reason);
      expect(signals.at(-1)?.aborted).toBe(true);

      const live = await page.image!({ dpi: 72 }, { signal: new AbortController().signal });
      expect([...live.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(signals.at(-1)?.aborted).toBe(false);
    } finally {
      await loader.dispose();
    }
  }, 120_000);

  it("rejects an already aborted call for an image source", async () => {
    const pdf = await makeInvoicePdf({ seed: 412 });
    const png = (await new NapiCanvasRasterizer().rasterize(
      { bytes: pdf.bytes, mimeType: "application/pdf" }, { dpi: 100, pages: [1] }, ctx,
    ))[0]!.bytes;
    const loader = create(recordingRasterizer().rasterizer);
    try {
      const document = await loader.load({ bytes: png, mimeType: "image/png" }, ctx);
      await expect(document.pages[0]!.image!(undefined, { signal: AbortSignal.abort() })).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(await document.pages[0]!.image!()).toBe(png);
    } finally {
      await loader.dispose();
    }
  }, 120_000);
});
