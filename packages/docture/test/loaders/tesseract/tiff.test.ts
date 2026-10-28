import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "docture";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { overlappingIfds, oversizedTiff, tiledTiff } from "../fixtures/tiff/crafted.js";

const engine = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => engine);

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/tiff/${name}`, import.meta.url)));
}

function firstIfd(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, bytes[0] === 0x49);
}

function points(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Call {
  readonly ifd: number;
  readonly output: Record<string, boolean>;
}

function fakeWorker(calls: Call[]) {
  return {
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async (image: Uint8Array, _options: unknown, output: Record<string, boolean>) => {
      const ifd = firstIfd(image);
      calls.push({ ifd, output });
      const png = Buffer.from([...PNG, ifd & 0xff, ifd >> 8]).toString("base64");
      return {
        data: {
          text: `page at ${ifd}`,
          confidence: 90,
          imageColor: `data:image/png;base64,${png}`,
          blocks: [{ paragraphs: [{ lines: [{ words: [
            { text: `ifd${ifd}`, confidence: 90, bbox: { x0: 10, y0: 10, x1: 60, y1: 30 } },
          ] }] }] }],
        },
      };
    }),
    terminate: vi.fn(async () => undefined),
  };
}

function engineCalls(): Call[] {
  const calls: Call[] = [];
  engine.createWorker.mockImplementation(async () => fakeWorker(calls));
  return calls;
}

afterEach(() => { engine.createWorker.mockReset(); });

describe("Tesseract TIFF input", () => {
  it("advertises TIFF without a rasterizer", () => {
    expect(new DocumentLoaderTesseract().capabilities.mimeTypes).toEqual(["image/png", "image/jpeg", "image/tiff"]);
  });

  it("recognizes each page of a multi-page TIFF in IFD order and serves PNG page images", async () => {
    const calls = engineCalls();
    const bytes = fixture("pages-lzw.tif");
    await using loader = new DocumentLoaderTesseract({ concurrency: 1 });
    const document = await loader.load({ bytes, mimeType: "image/tiff" }, ctx);

    expect(calls).toEqual([
      { ifd: 1682, output: { text: true, blocks: true, imageColor: true } },
      { ifd: 3792, output: { text: true, blocks: true, imageColor: true } },
    ]);
    expect(firstIfd(bytes)).toBe(1682);
    expect(document.pages.map((page) => [page.pageNumber, page.text, points(page.width), points(page.height)])).toEqual([
      [1, "ifd1682", 96, 28.8],
      [2, "ifd3792", 105.6, 30.72],
    ]);
    expect(document.meta).toMatchObject({ pageCount: 2, pagesRead: 2 });
    expect([...await document.pages[0]!.image!()]).toEqual([...PNG, 1682 & 0xff, 1682 >> 8]);
    expect([...await document.pages[1]!.image!()]).toEqual([...PNG, 3792 & 0xff, 3792 >> 8]);
  });

  it("reads big-endian TIFF the same way", async () => {
    const calls = engineCalls();
    await using loader = new DocumentLoaderTesseract({ concurrency: 1 });
    const document = await loader.load({ bytes: fixture("pages-lzw-be.tif") }, ctx);
    expect(calls.map((call) => call.ifd)).toEqual([1682, 3792]);
    expect(document.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
  });

  it("recognizes only the pages maxPages and the page request allow", async () => {
    const capped = engineCalls();
    await using first = new DocumentLoaderTesseract({ maxPages: 1 });
    const one = await first.load({ bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" }, ctx);
    expect(one.pages.map((page) => page.pageNumber)).toEqual([1]);
    expect(capped.map((call) => call.ifd)).toEqual([1682]);

    const requested = engineCalls();
    await using second = new DocumentLoaderTesseract();
    const two = await second.load(
      { bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" },
      { ...ctx, request: { pages: [2] } },
    );
    expect(two.pages.map((page) => [page.pageNumber, page.text])).toEqual([[2, "ifd3792"]]);
    expect(requested.map((call) => call.ifd)).toEqual([3792]);

    const outside = await second.load(
      { bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" },
      { ...ctx, request: { pages: [3] } },
    ).then(() => null, (error: unknown) => error);
    expect(outside).toMatchObject({ code: "PAGE_OUT_OF_RANGE" });
  });

  it("rejects malformed or unsupported TIFF before starting the engine", async () => {
    const calls = engineCalls();
    const looping = fixture("pages-lzw.tif");
    new DataView(looping.buffer).setUint32(3792 + 2 + 12 * new DataView(looping.buffer).getUint16(3792, true), 1682, true);
    await using loader = new DocumentLoaderTesseract();
    const malformed = await loader.load({ bytes: looping, mimeType: "image/tiff" }, ctx).then(() => null, (error: unknown) => error);
    const deflate = await loader.load({ bytes: fixture("pages-zip.tif"), mimeType: "image/tiff" }, ctx).then(() => null, (error: unknown) => error);
    expect(String(malformed)).toBe("Error: tesseract: these bytes are not a readable TIFF (image/tiff).");
    expect(String(deflate)).toBe(
      "Error: tesseract: TIFF page 1 uses compression 8, which this loader does not read. " +
        "Supported: none (1), CCITT G3 (3), CCITT G4 (4), LZW (5), PackBits (32773).",
    );
    expect(calls).toEqual([]);
    expect(engine.createWorker).not.toHaveBeenCalled();
  });

  it("rejects a page over 8192 x 8192 pixels, even labelled PNG, and overlapping IFDs before starting the engine", async () => {
    const calls = engineCalls();
    await using loader = new DocumentLoaderTesseract();
    const errors = [];
    for (const bytes of [oversizedTiff(40_000, 40_000), overlappingIfds(10, 5)]) {
      errors.push(String(await loader.load({ bytes, mimeType: "image/tiff" }, ctx).then(() => null, (error: unknown) => error)));
    }
    errors.push(String(await loader.load({ bytes: oversizedTiff(40_000, 40_000), mimeType: "image/png" }, ctx)
      .then(() => null, (error: unknown) => error)));
    expect(errors).toEqual([
      "Error: tesseract: TIFF page 1 is 40000x40000 pixels, more than the 67108864 this loader decodes.",
      "Error: tesseract: these bytes are not a readable TIFF (image/tiff).",
      "Error: tesseract: TIFF page 1 is 40000x40000 pixels, more than the 67108864 this loader decodes.",
    ]);
    expect(calls).toEqual([]);
    expect(engine.createWorker).not.toHaveBeenCalled();
  });
  it("rejects a 1x1 page with a 16000x16000 tile as unreadable before starting the engine", async () => {
    const calls = engineCalls();
    await using loader = new DocumentLoaderTesseract();
    const error = await loader.load({ bytes: tiledTiff(1, 1, 16000, 16000), mimeType: "image/tiff" }, ctx)
      .then(() => null, (failure: unknown) => failure);
    expect(String(error)).toBe("Error: tesseract: these bytes are not a readable TIFF (image/tiff).");
    expect(calls).toEqual([]);
    expect(engine.createWorker).not.toHaveBeenCalled();
  });
});
