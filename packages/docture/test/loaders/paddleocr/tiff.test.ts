import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger, tiffPages } from "docture";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
import { deflatedStripPage, overlappingIfds, tiledTiff } from "../fixtures/tiff/crafted.js";

const engine = vi.hoisted(() => ({ batches: [] as ArrayBuffer[][], started: 0 }));
vi.mock("ppu-paddle-ocr", () => ({
  PaddleOcrService: class {
    async initialize() { engine.started += 1; }
    async batchRecognize(images: readonly ArrayBuffer[]) {
      engine.batches.push([...images]);
      return images.map((_, index) => ({
        text: "",
        confidence: 1,
        results: [{ text: `image ${index}`, confidence: 1, box: { x: 0, y: 0, width: 10, height: 10 } }],
      }));
    }
    async destroy() {}
  },
}));

const decoding = vi.hoisted(() => ({ pages: 0, onPage: () => {} }));
vi.mock("utif2", async (importOriginal) => {
  type Utif = Record<"decode" | "decodeImage" | "toRGBA8", (...args: unknown[]) => unknown>;
  const actual = await importOriginal<Partial<Utif> & { default: Utif }>();
  const utif = typeof actual.decode === "function" ? (actual as Utif) : actual.default;
  const counted: Utif = {
    decode: utif.decode,
    toRGBA8: utif.toRGBA8,
    decodeImage: (...args) => {
      decoding.pages += 1;
      decoding.onPage();
      return utif.decodeImage(...args);
    },
  };
  return { ...counted, default: counted };
});

afterEach(() => {
  engine.batches.length = 0;
  engine.started = 0;
  decoding.pages = 0;
  decoding.onPage = () => {};
});

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const COMPRESSIONS = ["none", "g3", "g4", "lzw", "lzw-be", "zip", "packbits"];

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/tiff/${name}`, import.meta.url)));
}

async function pixels(png: Uint8Array): Promise<[number, number, number]> {
  const image = await loadImage(Buffer.from(png));
  const context = createCanvas(image.width, image.height).getContext("2d");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  let dark = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! < 128) dark += 1;
  return [image.width, image.height, dark];
}

function withCompression(bytes: Uint8Array, compression: number): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const ifd = tiffPages(copy)![0]!.ifdOffset;
  for (let entry = ifd + 2; entry < ifd + 2 + view.getUint16(ifd, true) * 12; entry += 12) {
    if (view.getUint16(entry, true) === 259) view.setUint16(entry + 8, compression, true);
  }
  return copy;
}

describe("PaddleOCR TIFF input", () => {
  it("advertises TIFF without a rasterizer", () => {
    expect(new DocumentLoaderPaddleOcr().capabilities.mimeTypes).toEqual(["image/png", "image/jpeg", "image/tiff"]);
  });

  it("hands the engine one decoded PNG per page in order and serves the same PNG as the page image", async () => {
    await using loader = new DocumentLoaderPaddleOcr();
    const document = await loader.load({ bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" }, ctx);

    expect(engine.batches).toHaveLength(1);
    const sent = engine.batches[0]!.map((buffer) => new Uint8Array(buffer));
    expect(sent.map((png) => [...png.subarray(0, 8)])).toEqual([PNG, PNG]);
    expect(await Promise.all(sent.map(pixels))).toEqual([[400, 120, 3296], [440, 128, 3307]]);
    expect(document.pages.map((page) => [page.pageNumber, page.text])).toEqual([[1, "image 0"], [2, "image 1"]]);
    expect(document.meta).toMatchObject({ pageCount: 2, pagesRead: 2 });
    const image = await document.pages[1]!.image!();
    expect([...image.subarray(0, 8)]).toEqual(PNG);
    expect(await pixels(image)).toEqual([440, 128, 3307]);
  });

  it("decodes TIFF bytes labelled PNG as TIFF", async () => {
    await using loader = new DocumentLoaderPaddleOcr();
    const document = await loader.load({ bytes: fixture("pages-lzw.tif"), mimeType: "image/png" }, ctx);
    const sent = engine.batches[0]!.map((buffer) => new Uint8Array(buffer));
    expect(await Promise.all(sent.map(pixels))).toEqual([[400, 120, 3296], [440, 128, 3307]]);
    expect(document.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
  });

  it.each(COMPRESSIONS)("decodes the %s fixture to the same pixels", async (name) => {
    await using loader = new DocumentLoaderPaddleOcr();
    await loader.load({ bytes: fixture(`pages-${name}.tif`), mimeType: "image/tiff" }, ctx);
    const sent = engine.batches[0]!.map((buffer) => new Uint8Array(buffer));
    expect(await Promise.all(sent.map(pixels))).toEqual([[400, 120, 3296], [440, 128, 3307]]);
  });

  it("decodes only the pages maxPages and the page request allow", async () => {
    await using capped = new DocumentLoaderPaddleOcr({ maxPages: 1 });
    const first = await capped.load({ bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" }, ctx);
    expect(first.pages.map((page) => page.pageNumber)).toEqual([1]);

    await using loader = new DocumentLoaderPaddleOcr();
    const second = await loader.load(
      { bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" },
      { ...ctx, request: { pages: [2] } },
    );
    expect(second.pages.map((page) => page.pageNumber)).toEqual([2]);
    const sent = engine.batches.map((batch) => batch.map((buffer) => new Uint8Array(buffer)));
    expect(await Promise.all(sent.flat().map(pixels))).toEqual([[400, 120, 3296], [440, 128, 3307]]);
  });

  it("rejects malformed or unsupported TIFF before the engine starts", async () => {
    const looping = fixture("pages-lzw.tif");
    new DataView(looping.buffer).setUint32(3792 + 2 + 12 * new DataView(looping.buffer).getUint16(3792, true), 1682, true);
    const inputs = [
      looping,
      fixture("pages-lzw.tif").subarray(0, 3000),
      new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0xff, 0xff]),
      withCompression(fixture("pages-lzw.tif"), 34712),
    ];
    await using loader = new DocumentLoaderPaddleOcr();
    const errors = [];
    for (const bytes of inputs) {
      errors.push(String(await loader.load({ bytes, mimeType: "image/tiff" }, ctx).then(() => null, (error: unknown) => error)));
    }
    expect(errors).toEqual([
      "Error: paddleocr: these bytes are not a readable TIFF (image/tiff).",
      "Error: paddleocr: these bytes are not a readable TIFF (image/tiff).",
      "Error: paddleocr: these bytes are not a readable TIFF (image/tiff).",
      "Error: paddleocr: TIFF page 1 uses compression 34712, which this loader does not read. " +
        "Supported: none (1), CCITT G3 (3), CCITT G4 (4), LZW (5), Deflate (8), PackBits (32773).",
    ]);
    expect(engine.started).toBe(0);
    expect(engine.batches).toEqual([]);
  });

  it("stops decoding at an abort, before the next page and before the engine starts", async () => {
    const controller = new AbortController();
    decoding.onPage = () => controller.abort(new Error("stop"));
    await using loader = new DocumentLoaderPaddleOcr();
    const error = await loader.load(
      { bytes: fixture("pages-lzw.tif"), mimeType: "image/tiff" },
      { ...ctx, signal: controller.signal },
    ).then(() => null, (failure: unknown) => failure);
    expect(String(error)).toBe("Error: stop");
    expect(decoding.pages).toBe(1);
    expect(engine.started).toBe(0);
  });

  it("rejects overlapping IFDs as unreadable before decoding", async () => {
    await using loader = new DocumentLoaderPaddleOcr();
    const error = await loader.load({ bytes: overlappingIfds(10, 5), mimeType: "image/tiff" }, ctx)
      .then(() => null, (failure: unknown) => failure);
    expect(String(error)).toBe("Error: paddleocr: these bytes are not a readable TIFF (image/tiff).");
    expect(decoding.pages).toBe(0);
    expect(engine.started).toBe(0);
  });

  it("rejects a 1x1 page with a 16000x16000 tile as unreadable before decoding", async () => {
    await using loader = new DocumentLoaderPaddleOcr();
    const error = await loader.load({ bytes: tiledTiff(1, 1, 16000, 16000), mimeType: "image/tiff" }, ctx)
      .then(() => null, (failure: unknown) => failure);
    expect(String(error)).toBe("Error: paddleocr: these bytes are not a readable TIFF (image/tiff).");
    expect(decoding.pages).toBe(0);
    expect(engine.started).toBe(0);
  });

  it("rejects a Deflate strip that inflates past its page as unreadable before decoding", async () => {
    await using loader = new DocumentLoaderPaddleOcr();
    const fits = await loader.load({ bytes: deflatedStripPage(16, 16, 256), mimeType: "image/tiff" }, ctx);
    expect(fits.pages.map((page) => [page.pageNumber, page.text])).toEqual([[1, "image 0"]]);
    decoding.pages = 0;
    engine.started = 0;

    const bomb = deflatedStripPage(16, 16, 16 * 2 ** 20);
    expect(bomb.length).toBeLessThan(20_000);
    const error = await loader.load({ bytes: bomb, mimeType: "image/tiff" }, ctx)
      .then(() => null, (failure: unknown) => failure);
    expect(String(error)).toBe("Error: paddleocr: these bytes are not a readable TIFF.");
    expect(decoding.pages).toBe(0);
  });

  it("decodes a tiled page without writing to stdout", () => {
    const require = createRequire(new URL("../../../../../apps/docs/package.json", import.meta.url));
    const script = fileURLToPath(new URL("../fixtures/tiff/tiled-paddle.mjs", import.meta.url));
    const root = fileURLToPath(new URL("../../../../../", import.meta.url));
    const run = spawnSync(process.execPath, ["--import", require.resolve("tsx/esm"), script, root], { encoding: "utf8" });
    expect(run.status, run.stderr.slice(0, 500)).toBe(0);
    expect(JSON.parse(run.stderr)).toEqual([1, [80, 78, 71], 32, 32]);
    expect(run.stdout).toBe("");
  });

  it("decodes a page whose sub-IFDs fan out 2^24 ways without following them, in a 128 MB heap", () => {
    const require = createRequire(new URL("../../../../../apps/docs/package.json", import.meta.url));
    const script = fileURLToPath(new URL("../fixtures/tiff/subifd-paddle.mjs", import.meta.url));
    const root = fileURLToPath(new URL("../../../../../", import.meta.url));
    const run = spawnSync(
      process.execPath,
      ["--max-old-space-size=128", "--import", require.resolve("tsx/esm"), script, root, "24"],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(run.signal).toBeNull();
    expect(run.status, run.stderr.slice(0, 500)).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([[1, 0.96, 0.96]]);
  });

  it("reports malformed TIFF as an error in a process running the real engine", () => {
    const require = createRequire(new URL("../../../../../apps/docs/package.json", import.meta.url));
    const script = fileURLToPath(new URL("../fixtures/tiff/malformed-paddle.mjs", import.meta.url));
    const root = fileURLToPath(new URL("../../../../../", import.meta.url));
    const run = spawnSync(process.execPath, ["--import", require.resolve("tsx/esm"), script, root], { encoding: "utf8" });
    expect(run.signal).toBeNull();
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([
      "paddleocr: these bytes are not a readable TIFF (image/tiff).",
      "paddleocr: these bytes are not a readable TIFF (image/tiff).",
    ]);
  });
});
