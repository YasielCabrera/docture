/**
 * Pixel dimensions from a PNG, JPEG or classic TIFF header.
 *
 * In core for the same reason {@link linesFromWords} is: every OCR loader needs it
 * and none of them should own it. An OCR loader can be handed an image directly,
 * with no PDF and no rasterizer in sight — and a page still has to report a width
 * and a height. Two loaders each carrying their own copy of a JPEG segment walker is
 * two copies to drift.
 *
 * Read from the header rather than decoded: the engine is going to decode the pixels
 * anyway, and this only has to answer "how big".
 *
 * PNG and JPEG because a {@link Rasterizer} in this library emits them, TIFF
 * because scanners and fax software do; a TIFF reports its first page. A format we
 * cannot size is a format we do not claim to accept.
 */

import { tiffPages } from "./tiff.js";

export interface ImageSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Start-of-frame markers. Baseline, progressive, and the lossless/arithmetic set. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export const DEFAULT_MAX_PIXELS = 40_000_000;

export function withinPixels(
  widthPt: number,
  heightPt: number,
  scale: number,
  maxPixels: number,
  round: (value: number) => number,
): number {
  if (!(maxPixels >= 1)) throw new RangeError(`maxPixels must be at least 1, got ${maxPixels}.`);
  const pixels = (value: number): number => Math.max(1, round(widthPt * value)) * Math.max(1, round(heightPt * value));
  if (pixels(scale) <= maxPixels) return scale;
  let fitted = Math.sqrt(maxPixels / (widthPt * heightPt));
  while (fitted > 0 && pixels(fitted) > maxPixels) fitted *= 0.9999;
  return fitted;
}

/** `undefined` when the bytes are not a PNG, JPEG or TIFF we can read a size from. */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  return pngSize(bytes) ?? jpegSize(bytes) ?? tiffSize(bytes);
}

function tiffSize(bytes: Uint8Array): ImageSize | undefined {
  const first = tiffPages(bytes)?.[0];
  return first === undefined ? undefined : { widthPx: first.widthPx, heightPx: first.heightPx };
}

function pngSize(bytes: Uint8Array): ImageSize | undefined {
  // 8-byte signature, then the IHDR chunk, whose first two fields are the size.
  if (bytes.length < 24) return undefined;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => bytes[i] === byte)) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
}

/**
 * The EXIF orientation of a JPEG, 1 to 8, or 1 when it has none. Orientations 5
 * to 8 turn the image a quarter, so its displayed width is the header's height.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  let orientation = 1;
  jpegSegments(bytes, (marker, start, length) => {
    if (marker !== 0xe1 || length < 14) return false;
    const exif = bytes.subarray(start, start + length);
    if (String.fromCharCode(...exif.subarray(0, 6)) !== "Exif\0\0") return false;
    orientation = tiffOrientation(exif.subarray(6)) ?? 1;
    return true;
  });
  return orientation;
}

function tiffOrientation(tiff: Uint8Array): number | undefined {
  if (tiff.length < 8) return undefined;
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!littleEndian && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return undefined;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifd = view.getUint32(4, littleEndian);
  if (ifd + 2 > tiff.length) return undefined;
  const count = view.getUint16(ifd, littleEndian);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return undefined;
    if (view.getUint16(entry, littleEndian) !== 0x0112) continue;
    const value = view.getUint16(entry + 8, littleEndian);
    return value >= 1 && value <= 8 ? value : undefined;
  }
  return undefined;
}

function jpegSize(bytes: Uint8Array): ImageSize | undefined {
  let size: ImageSize | undefined;
  jpegSegments(bytes, (marker, start, length, view) => {
    if (!SOF_MARKERS.has(marker)) return false;
    // precision(1) height(2) width(2), from the marker's payload.
    if (length >= 5) size = { heightPx: view.getUint16(start + 1), widthPx: view.getUint16(start + 3) };
    return true;
  });
  return size;
}

function jpegSegments(
  bytes: Uint8Array,
  visit: (marker: number, start: number, length: number, view: DataView) => boolean,
): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 2;
  while (offset + 3 < bytes.length) {
    // Segments are 0xFF followed by a marker; a run of 0xFF bytes is padding.
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers: no length field to skip.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return; // end, or entropy data

    const length = view.getUint16(offset + 2);
    if (length < 2) return;
    const start = offset + 4;
    if (visit(marker, start, Math.min(length - 2, bytes.length - start), view)) return;
    offset += 2 + length;
  }
}
