import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { imageSize, silentLogger } from "docture";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const RUN_OCR = process.env["RUN_OCR"] === "1" || process.env["RUN_OCR"] === "true";
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/tiff/${name}`, import.meta.url)));
}

describe.skipIf(!RUN_OCR)("PaddleOCR TIFF real OCR", () => {
  it.each(["pages-none.tif", "pages-lzw.tif", "pages-lzw-be.tif", "pages-zip.tif", "pages-packbits.tif", "pages-g3.tif", "pages-g4.tif"])(
    "reads both pages of %s in order and returns PNG page images",
    async (name) => {
      await using loader = new DocumentLoaderPaddleOcr();
      const document = await loader.load({ bytes: fixture(name), mimeType: "image/tiff" }, ctx);
      expect(document.pages.map((page) => page.text.trim())).toEqual(["PAGE ONE", "PAGE TWO"]);
      const image = await document.pages[1]!.image!();
      expect([...image.subarray(0, 8)]).toEqual(PNG);
      expect(imageSize(image)).toEqual({ widthPx: 440, heightPx: 128 });
    },
    60_000,
  );

  it("reads only the selected or capped pages", async () => {
    await using loader = new DocumentLoaderPaddleOcr();
    const selected = await loader.load(
      { bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" },
      { ...ctx, request: { pages: [2] } },
    );
    expect(selected.pages.map((page) => [page.pageNumber, page.text.trim()])).toEqual([[2, "PAGE TWO"]]);

    await using capped = new DocumentLoaderPaddleOcr({ maxPages: 1 });
    const first = await capped.load({ bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" }, ctx);
    expect(first.pages.map((page) => [page.pageNumber, page.text.trim()])).toEqual([[1, "PAGE ONE"]]);
  }, 60_000);
});
