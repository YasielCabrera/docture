import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { imageSize, tiffPages } from "docture";
import { FIRST_IFD, overlappingIfds, retaggedPage, tiledTiff } from "../loaders/fixtures/tiff/crafted.js";

const SHORT = 3;
const LONG = 4;
const ENTRIES_PER_IFD = 5;
const IFD_SIZE = 2 + ENTRIES_PER_IFD * 12 + 4;
/** Where `syntheticTiff` writes the IFD of its second page. */
const SECOND_IFD = FIRST_IFD + IFD_SIZE;
const entryAt = (ifd: number, index: number) => ifd + 2 + index * 12;
const nextIfdPointer = (ifd: number) => entryAt(ifd, ENTRIES_PER_IFD);

interface SyntheticPage {
  readonly width: number;
  readonly height: number;
  readonly compression?: number;
}

function syntheticTiff(littleEndian: boolean, pages: readonly SyntheticPage[]): Uint8Array {
  const stripStart = FIRST_IFD + pages.length * IFD_SIZE;
  const bytes = new Uint8Array(stripStart + pages.length * 4);
  const view = new DataView(bytes.buffer);
  bytes.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, FIRST_IFD, littleEndian);
  pages.forEach((page, index) => {
    const ifd = FIRST_IFD + index * IFD_SIZE;
    view.setUint16(ifd, ENTRIES_PER_IFD, littleEndian);
    const entries: [number, number, number][] = [
      [256, SHORT, page.width],
      [257, LONG, page.height],
      [259, SHORT, page.compression ?? 1],
      [273, LONG, stripStart + index * 4],
      [279, LONG, 4],
    ];
    entries.forEach(([tag, type, value], entry) => {
      const at = entryAt(ifd, entry);
      view.setUint16(at, tag, littleEndian);
      view.setUint16(at + 2, type, littleEndian);
      view.setUint32(at + 4, 1, littleEndian);
      if (type === SHORT) view.setUint16(at + 8, value, littleEndian);
      else view.setUint32(at + 8, value, littleEndian);
    });
    const next = index + 1 < pages.length ? ifd + IFD_SIZE : 0;
    view.setUint32(nextIfdPointer(ifd), next, littleEndian);
  });
  return bytes;
}

const twoPages = [{ width: 64, height: 32 }, { width: 32, height: 16, compression: 5 }];

function withUint32(bytes: Uint8Array, offset: number, value: number, littleEndian: boolean): Uint8Array {
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint32(offset, value, littleEndian);
  return copy;
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../loaders/fixtures/tiff/${name}`, import.meta.url)));
}

describe("TIFF page sizing", () => {
  it.each([
    ["little-endian", true],
    ["big-endian", false],
  ])("sizes every page of a %s classic TIFF in IFD order", (_name, littleEndian) => {
    const bytes = syntheticTiff(littleEndian, twoPages);
    expect(imageSize(bytes)).toEqual({ widthPx: 64, heightPx: 32 });
    expect(tiffPages(bytes)).toEqual([
      { pageNumber: 1, widthPx: 64, heightPx: 32, ifdOffset: FIRST_IFD, littleEndian, compression: 1 },
      { pageNumber: 2, widthPx: 32, heightPx: 16, ifdOffset: SECOND_IFD, littleEndian, compression: 5 },
    ]);
  });

  it("reads libtiff output in both byte orders", () => {
    for (const [name, littleEndian] of [["pages-lzw.tif", true], ["pages-lzw-be.tif", false]] as const) {
      expect(tiffPages(fixture(name))).toEqual([
        { pageNumber: 1, widthPx: 400, heightPx: 120, ifdOffset: 1682, littleEndian, compression: 5 },
        { pageNumber: 2, widthPx: 440, heightPx: 128, ifdOffset: 3792, littleEndian, compression: 5 },
      ]);
      expect(imageSize(fixture(name))).toEqual({ widthPx: 400, heightPx: 120 });
    }
  });

  it("stops at an IFD chain that loops back on itself", () => {
    const valid = syntheticTiff(true, twoPages);
    expect(tiffPages(valid)?.map((page) => page.pageNumber)).toEqual([1, 2]);
    const backToFirst = withUint32(valid, nextIfdPointer(SECOND_IFD), FIRST_IFD, true);
    const ontoItself = withUint32(valid, nextIfdPointer(FIRST_IFD), FIRST_IFD, true);
    expect(tiffPages(backToFirst)).toBeUndefined();
    expect(tiffPages(ontoItself)).toBeUndefined();
    expect(imageSize(backToFirst)).toBeUndefined();
  });

  it("refuses IFDs that share bytes, in time linear in the file", () => {
    expect(tiffPages(overlappingIfds(10, 5))).toBeUndefined();
    const large = overlappingIfds(45_000, 24_000);
    expect(large.length).toBe(828_080);
    const started = performance.now();
    expect(tiffPages(large)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("refuses truncated files, out-of-range offsets and BigTIFF", () => {
    const valid = syntheticTiff(false, twoPages);
    expect(tiffPages(valid.subarray(0, valid.length - 1))).toBeUndefined();
    expect(tiffPages(valid.subarray(0, 100))).toBeUndefined();
    expect(tiffPages(withUint32(valid, 4, valid.length, false))).toBeUndefined();
    expect(tiffPages(withUint32(valid, 4, 0, false))).toBeUndefined();
    const real = fixture("pages-lzw.tif");
    expect(tiffPages(real.subarray(0, 3000))).toBeUndefined();
    const bigTiff = valid.slice();
    bigTiff[3] = 43;
    expect(tiffPages(bigTiff)).toBeUndefined();
    expect(tiffPages(new Uint8Array([0x49, 0x49, 42, 0]))).toBeUndefined();
  });

  it("refuses a page without a size or image data, or with an entry outside the file", () => {
    const valid = syntheticTiff(true, [{ width: 64, height: 32 }]);
    expect(tiffPages(valid)).toHaveLength(1);
    const zeroWidth = valid.slice();
    new DataView(zeroWidth.buffer).setUint16(entryAt(FIRST_IFD, 0) + 8, 0, true);
    const noStrips = valid.slice();
    new DataView(noStrips.buffer).setUint16(entryAt(FIRST_IFD, 3), 999, true);
    const description = valid.slice();
    const entry = new DataView(description.buffer, entryAt(FIRST_IFD, 2), 12);
    entry.setUint16(0, 270, true);
    entry.setUint16(2, 2, true);
    entry.setUint32(4, 100, true);
    entry.setUint32(8, 9999, true);
    expect(tiffPages(zeroWidth)).toBeUndefined();
    expect(tiffPages(noStrips)).toBeUndefined();
    expect(tiffPages(description)).toBeUndefined();
    entry.setUint32(4, 10, true);
    entry.setUint32(8, 0, true);
    expect(tiffPages(description)?.[0]?.compression).toBe(1);
  });
  it("reads tiled pages whose tiles fit the page or the usual 256 to 1024 pixel sizes", () => {
    const page = (widthPx: number, heightPx: number) =>
      [{ pageNumber: 1, widthPx, heightPx, ifdOffset: FIRST_IFD, littleEndian: true, compression: 1 }];
    expect(tiffPages(tiledTiff(10, 10, 256, 256))).toEqual(page(10, 10));
    expect(tiffPages(tiledTiff(1, 1, 1024, 1024))).toEqual(page(1, 1));
    expect(tiffPages(tiledTiff(2000, 1500, 512, 512))).toEqual(page(2000, 1500));
    expect(tiffPages(retaggedPage({ 258: 16, 277: 4, 278: 2 }))).toEqual(page(4, 4));
  });

  it("refuses a tile far larger than its page, which a decoder would allocate in full", () => {
    expect(tiffPages(tiledTiff(1, 1, 16000, 16000))).toBeUndefined();
    expect(tiffPages(tiledTiff(1, 1, 1024, 1040))).toBeUndefined();
    expect(tiffPages(tiledTiff(2000, 1500, 4096, 4096))).toBeUndefined();
  });

  it("refuses tile layouts that leave pixels uncovered or span far more tiles than the page needs", () => {
    expect(tiffPages(tiledTiff(32, 32, 16, 16, 3))).toBeUndefined();
    expect(tiffPages(tiledTiff(4096, 1, 1, 1024))).toBeUndefined();
    expect(tiffPages(tiledTiff(4, 4, 0, 16, 1))).toBeUndefined();
    expect(tiffPages(tiledTiff(4, 4, 16, 0, 1))).toBeUndefined();
  });

  it("refuses a striped page that also carries tile tags, since decoders then read it as tiled", () => {
    expect(tiffPages(retaggedPage({ 322: 16000, 323: 16000 }))).toBeUndefined();
    expect(tiffPages(retaggedPage({ 323: 16000 }))).toBeUndefined();
  });

  it("refuses zero rows per strip, more than 64 bits per pixel and camera-raw layouts", () => {
    expect(tiffPages(retaggedPage({ 278: 0 }))).toBeUndefined();
    expect(tiffPages(retaggedPage({ 258: 0 }))).toBeUndefined();
    expect(tiffPages(retaggedPage({ 277: 0 }))).toBeUndefined();
    expect(tiffPages(retaggedPage({ 258: 32, 277: 3 }))).toBeUndefined();
    expect(tiffPages(retaggedPage({ 258: 65535, 277: 65535 }))).toBeUndefined();
    expect(tiffPages(retaggedPage({ 262: 32803 }))).toBeUndefined();
    expect(tiffPages(retaggedPage({ 50885: 4 }))).toBeUndefined();
  });
});
