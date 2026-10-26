import * as zlib from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = { width: 1, height: 1, data: new Uint8ClampedArray([12, 34, 56, 255]) };
const expected = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63e051b2f80f00020a0166786829330000000049454e44ae426082";

function referenceCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function seededPixels(): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(32 * 16 * 4);
  let value = 17;
  for (let index = 0; index < bytes.length; index++) {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    bytes[index] = value & 255;
  }
  return bytes;
}

afterEach(() => { vi.doUnmock("node:zlib"); vi.resetModules(); });

describe("PNG checksums", () => {
  it("uses native CRC when available and preserves exact PNG bytes", async () => {
    const native = vi.fn(zlib.crc32 ?? referenceCrc);
    vi.doMock("node:zlib", () => ({ ...zlib, crc32: native }));
    const { pngFromPdfJsImage } = await import("../../../src/loaders/pdfjs/png.js");
    const png = pngFromPdfJsImage(fixture, { RGBA_32BPP: 3 });
    expect(native).toHaveBeenCalledTimes(3);
    expect(Buffer.from(png ?? []).toString("hex")).toBe(expected);
  });

  it("preserves exact PNG bytes when native CRC is unavailable", async () => {
    vi.doMock("node:zlib", () => ({ ...zlib, crc32: undefined }));
    const { pngFromPdfJsImage } = await import("../../../src/loaders/pdfjs/png.js");
    const png = pngFromPdfJsImage(fixture, { RGBA_32BPP: 3 });
    expect(Buffer.from(png ?? []).toString("hex")).toBe(expected);
  });

  it("matches empty and seeded checksums and the encoded fixture on both paths", async () => {
    const pixels = seededPixels();
    const bytes = new Uint8Array(pixels);
    const native = zlib.crc32 ?? referenceCrc;
    expect(native(new Uint8Array())).toBe(0);
    expect(referenceCrc(new Uint8Array())).toBe(0);
    expect(native(bytes)).toBe(3523709088);
    expect(referenceCrc(bytes)).toBe(3523709088);
    for (const crc32 of [native, undefined]) {
      vi.resetModules();
      vi.doMock("node:zlib", () => ({ ...zlib, crc32 }));
      const { pngFromPdfJsImage } = await import("../../../src/loaders/pdfjs/png.js");
      const output = pngFromPdfJsImage({ width: 32, height: 16, data: pixels }, { RGBA_32BPP: 3 });
      expect(createHash("sha256").update(output ?? new Uint8Array()).digest("hex")).toBe("1aa237d1384542623be5d1b77c7962d7ac6ab625d182de47ff9654f33c532185");
    }
  });
});
