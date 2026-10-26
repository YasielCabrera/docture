import { describe, expect, it, vi } from "vitest";
import { silentLogger, type Rasterizer } from "docture";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";

vi.mock("../../src/loaders/tesseract/tesseract.js", () => ({
  TesseractPool: class {
    async recognize() { return { words: [{ text: "Invoice", box: [0, 0, 10, 10], confidence: 1 }], confidence: 1 }; }
    async terminate() {}
  },
}));
vi.mock("../../src/loaders/paddleocr/paddle.js", () => ({
  PaddleEngine: class {
    async recognizeAll(images: readonly Uint8Array[]) { return images.map(() => ({ regions: [{ text: "Invoice", box: [0, 0, 10, 10], confidence: 1 }], confidence: 1 })); }
    async destroy() {}
  },
}));

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const raw = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" };

describe.each([
  ["Tesseract", DocumentLoaderTesseract],
  ["PaddleOCR", DocumentLoaderPaddleOcr],
] as const)("%s page image retries", (_name, Loader) => {
  it("retries a failed render and memoizes the successful image", async () => {
    let calls = 0;
    const rasterizer: Rasterizer = {
      name: "flaky", formats: ["png"],
      async rasterize(_raw, options) {
        calls++;
        if (calls === 2) throw Error("transient render failure");
        return [{ pageNumber: options?.pages?.[0] ?? 3, bytes: new Uint8Array([calls]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }];
      },
    };
    const loader = new Loader({ rasterizer });
    const loaded = await loader.load(raw, ctx);
    const image = loaded.pages[0]?.image;
    await expect(image?.()).rejects.toThrow("transient render failure");
    expect(await image?.().catch(() => undefined)).toEqual(new Uint8Array([3]));
    expect(await image?.()).toEqual(new Uint8Array([3]));
    expect(calls).toBe(3);
    await loader.dispose();
  });
});
