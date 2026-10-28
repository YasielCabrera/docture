import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "docture";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { retaggedPage } from "../fixtures/tiff/crafted.js";
import { patternSamples, pngRgba, sampleTiff, type SampleTiff } from "../fixtures/tiff/samples.js";

const engine = vi.hoisted(() => ({ started: 0 }));
vi.mock("ppu-paddle-ocr", () => ({
  PaddleOcrService: class {
    async initialize() { engine.started += 1; }
    async batchRecognize(images: readonly ArrayBuffer[]) {
      return images.map(() => ({ text: "", confidence: 1, results: [] }));
    }
    async destroy() {}
  },
}));

const decoding = vi.hoisted(() => ({ compressions: [] as unknown[], stopAt: undefined as string | undefined }));
vi.mock("utif2", async (importOriginal) => {
  type Utif = Record<"decode" | "decodeImage" | "toRGBA8", (...args: unknown[]) => unknown>;
  const actual = await importOriginal<Partial<Utif> & { default: Utif }>();
  const utif = typeof actual.decode === "function" ? (actual as Utif) : actual.default;
  const observed: Utif = {
    decode: utif.decode,
    toRGBA8: utif.toRGBA8,
    decodeImage: (buffer, ifd) => {
      decoding.compressions.push((ifd as { t259?: unknown }).t259);
      if (decoding.stopAt !== undefined) throw new Error(decoding.stopAt);
      return utif.decodeImage(buffer, ifd);
    },
  };
  return { ...observed, default: observed };
});

const inflating = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return {
    ...actual,
    inflateRawSync: (...args: Parameters<typeof actual.inflateRawSync>) => {
      inflating.calls += 1;
      return actual.inflateRawSync(...args);
    },
  };
});

afterEach(() => {
  engine.started = 0;
  decoding.compressions.length = 0;
  decoding.stopAt = undefined;
  inflating.calls = 0;
});

const ctx = { signal: new AbortController().signal, logger: silentLogger };

async function pageImage(bytes: Uint8Array) {
  await using loader = new DocumentLoaderPaddleOcr();
  const document = await loader.load({ bytes, mimeType: "image/tiff" }, ctx);
  return pngRgba(await document.pages[0]!.image!());
}

async function loadError(loader: DocumentLoaderPaddleOcr | DocumentLoaderTesseract, bytes: Uint8Array) {
  try {
    return await loader.load({ bytes, mimeType: "image/tiff" }, ctx).then(() => null, (error: unknown) => error as Error);
  } finally {
    await loader.dispose();
  }
}

function expectedRgba(spec: SampleTiff): Uint8Array {
  const pixels = spec.width * spec.height;
  const sampleBytes = spec.bitsPerSample / 8;
  const rgba = new Uint8Array(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const sample = (index: number) => spec.samples[(pixel * spec.samplesPerPixel + index) * sampleBytes + sampleBytes - 1]!;
    if (spec.samplesPerPixel === 1) rgba.set([sample(0), sample(0), sample(0), 255], pixel * 4);
    else rgba.set([sample(0), sample(1), sample(2), sample(3)], pixel * 4);
  }
  return rgba;
}

function spec(width: number, height: number, bitsPerSample: 8 | 16, samplesPerPixel: 1 | 4, compression: 1 | 8, rowsPerStrip: number): SampleTiff {
  return {
    width, height, bitsPerSample, samplesPerPixel, compression, rowsPerStrip,
    photometric: samplesPerPixel === 4 ? 2 : 1,
    samples: patternSamples((width * height * samplesPerPixel * bitsPerSample) / 8, width * 31 + height),
  };
}

describe("PaddleOCR TIFF decoding within byte limits", () => {
  it.each([
    ["8-bit RGBA, uncompressed", spec(37, 23, 8, 4, 1, 5)],
    ["8-bit RGBA, Deflate in strips", spec(37, 23, 8, 4, 8, 5)],
    ["16-bit RGBA, uncompressed", spec(37, 23, 16, 4, 1, 23)],
    ["16-bit RGBA, Deflate in strips", spec(37, 23, 16, 4, 8, 4)],
    ["16-bit gray, Deflate", spec(41, 19, 16, 1, 8, 19)],
    ["8-bit gray wider than one conversion band, Deflate", spec(8192, 600, 8, 1, 8, 64)],
    ["16-bit RGBA, Deflate in tiles", { ...spec(37, 23, 16, 4, 8, 23), tileSize: 16 }],
  ])("serves the exact pixels of a %s page", async (_name, page) => {
    const image = await pageImage(sampleTiff(page));
    expect([image.width, image.height]).toEqual([page.width, page.height]);
    expect(Buffer.compare(image.rgba, expectedRgba(page))).toBe(0);
  });

  it("inflates each Deflate strip once and hands utif2 the inflated samples", async () => {
    const page = spec(37, 23, 16, 4, 8, 4);
    const image = await pageImage(sampleTiff(page));
    expect(Buffer.compare(image.rgba, expectedRgba(page))).toBe(0);
    expect(inflating.calls).toBe(6);
    expect(decoding.compressions).toEqual([[1]]);
  });

  it("refuses a page whose samples decode past 256 MiB before decoding, in both OCR loaders", async () => {
    const rgba16 = (height: number) =>
      retaggedPage({ 256: 8192, 257: height, 258: 16, 262: 2, 277: 4, 278: height });
    const errors = [
      await loadError(new DocumentLoaderPaddleOcr(), rgba16(8192)),
      await loadError(new DocumentLoaderPaddleOcr(), rgba16(4097)),
      await loadError(new DocumentLoaderTesseract(), rgba16(8192)),
    ].map(String);

    expect(errors).toEqual([
      "Error: paddleocr: TIFF page 1 is 8192x8192 pixels whose samples decode to 536870912 bytes, " +
        "more than the 268435456 this loader decodes.",
      "Error: paddleocr: TIFF page 1 is 8192x4097 pixels whose samples decode to 268500992 bytes, " +
        "more than the 268435456 this loader decodes.",
      "Error: tesseract: TIFF page 1 is 8192x8192 pixels whose samples decode to 536870912 bytes, " +
        "more than the 268435456 this loader decodes.",
    ]);
    expect(decoding.compressions).toEqual([]);
    expect(engine.started).toBe(0);
  });

  it("decodes a page at exactly 256 MiB of samples", async () => {
    decoding.stopAt = "reached the decoder";
    const errors = [
      await loadError(new DocumentLoaderPaddleOcr(), retaggedPage({ 256: 8192, 257: 8192, 258: 8, 262: 2, 277: 4, 278: 8192 })),
      await loadError(new DocumentLoaderPaddleOcr(), retaggedPage({ 256: 8192, 257: 4096, 258: 16, 262: 2, 277: 4, 278: 4096 })),
    ];
    expect(errors.map((error) => (error?.cause as Error | undefined)?.message)).toEqual([
      "reached the decoder",
      "reached the decoder",
    ]);
    expect(decoding.compressions).toEqual([[1], [1]]);
  });

  it("rejects a corrupt Deflate strip as unreadable before decoding", async () => {
    const page = spec(16, 16, 8, 1, 8, 16);
    const corrupt = sampleTiff(page);
    // The first bytes of the raw stream, after its zlib header: 0xff starts an invalid block type.
    const stream = corrupt.length - deflateSync(page.samples).length + 2;
    corrupt.fill(0xff, stream, stream + 4);
    const error = await loadError(new DocumentLoaderPaddleOcr(), corrupt);
    expect(String(error)).toBe("Error: paddleocr: these bytes are not a readable TIFF.");
    expect(decoding.compressions).toEqual([]);
  });
});
