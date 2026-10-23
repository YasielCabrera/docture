/**
 * Synthetic headers, on purpose: this reader's job is to answer "how big" from a
 * handful of bytes, and hand-built bytes are the only way to test the awkward
 * cases — a padding run of `0xFF`, a standalone marker with no length field, a
 * truncated signature — that a real encoder will not produce on demand.
 *
 * The loader packages assert the same function against real PNG and JPEG output
 * from a rasterizer; that is the other half of the coverage.
 */

import { describe, expect, it } from "vitest";
import { imageSize } from "../../src/core/index.js";

function u16(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/** Signature, then an IHDR chunk whose first two fields are the size. */
function png(widthPx: number, heightPx: number): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, ...u16(widthPx),
    0x00, 0x00, ...u16(heightPx),
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, colour type, and the rest
  ]);
}

/**
 * SOI, then `before` segments, then a start-of-frame carrying the size — which is
 * how a real JPEG hides its dimensions behind however much metadata it likes.
 */
function jpeg(widthPx: number, heightPx: number, before: readonly number[] = []): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    ...before,
    0xff, 0xc0, ...u16(11), 0x08, ...u16(heightPx), ...u16(widthPx), 0x03,
  ]);
}

/** An APP segment of `payload` filler bytes — metadata to be skipped over. */
function appSegment(payload: number): number[] {
  return [0xff, 0xe1, ...u16(payload + 2), ...new Array<number>(payload).fill(0x00)];
}

describe("imageSize", () => {
  it("reads a PNG's dimensions from IHDR", () => {
    expect(imageSize(png(1240, 1753))).toEqual({ widthPx: 1240, heightPx: 1753 });
  });

  it("reads a JPEG's dimensions from the start-of-frame", () => {
    expect(imageSize(jpeg(595, 841))).toEqual({ widthPx: 595, heightPx: 841 });
  });

  it("walks past a JPEG's metadata segments to find the frame", () => {
    const withMetadata = jpeg(800, 600, [...appSegment(64), ...appSegment(3000)]);
    expect(imageSize(withMetadata)).toEqual({ widthPx: 800, heightPx: 600 });
  });

  it("treats a run of 0xFF as padding rather than a marker", () => {
    // Legal between segments, and reading each one as a marker would desynchronize
    // the walk and return a size read out of the middle of someone's thumbnail.
    expect(imageSize(jpeg(320, 240, [0xff, 0xff, 0xff]))).toEqual({
      widthPx: 320,
      heightPx: 240,
    });
  });

  it("skips standalone markers, which carry no length to skip by", () => {
    // RST0-RST7 and TEM are two bytes and nothing more. Reading the next two as a
    // length would jump into the middle of the entropy data.
    expect(imageSize(jpeg(64, 32, [0xff, 0x01, 0xff, 0xd3]))).toEqual({
      widthPx: 64,
      heightPx: 32,
    });
  });

  it("gives up at the entropy data instead of scanning compressed pixels", () => {
    // Past SOS every byte is compressed pixels, where 0xFF sequences occur by
    // chance. A size found in there is a coincidence, not a dimension.
    const scanFirst = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, ...jpeg(10, 10)]);
    expect(imageSize(scanFirst)).toBeUndefined();
  });

  it("reads through a view into a larger buffer", () => {
    // Node pools small Buffers, so bytes handed to a loader are routinely a window
    // onto a bigger allocation. Ignoring byteOffset would read the neighbour's data.
    const slab = new Uint8Array(64 + 29);
    const bytes = png(1024, 768);
    slab.set(bytes, 64);
    expect(imageSize(slab.subarray(64, 64 + bytes.length))).toEqual({
      widthPx: 1024,
      heightPx: 768,
    });
  });

  it("returns undefined rather than a guess for anything else", () => {
    expect(imageSize(new Uint8Array(0))).toBeUndefined();
    expect(imageSize(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeUndefined(); // %PDF-
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined();
    // A truncated PNG signature must not be read as a size.
    expect(imageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    // Full signature, but the IHDR is cut off before the height.
    expect(imageSize(png(100, 100).subarray(0, 20))).toBeUndefined();
  });

  it("refuses a malformed segment length instead of looping forever", () => {
    // A length below 2 would advance the cursor by nothing at all.
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x00]))).toBeUndefined();
  });
});
