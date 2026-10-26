import { describe, expect, it, vi } from "vitest";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";

describe("OCR scope disposal", () => {
  it.each([
    ["Tesseract", DocumentLoaderTesseract],
    ["PaddleOCR", DocumentLoaderPaddleOcr],
  ] as const)("disposes %s at await using scope exit", async (_name, Loader) => {
    const loader = new Loader();
    const dispose = vi.spyOn(loader, "dispose");
    let error: unknown;
    try { await using scoped = loader; expect(scoped).toBe(loader); }
    catch (cause) { error = cause; }
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
  });
});
