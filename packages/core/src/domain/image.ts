/**
 * Pixel dimensions from a PNG or JPEG header.
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
 * PNG and JPEG specifically, because those are the two formats a
 * {@link Rasterizer} in this library emits and the two `sniffMimeType` recognises
 * as OCR-able input. A format we cannot size is a format we do not claim to accept.
 */

export interface ImageSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Start-of-frame markers. Baseline, progressive, and the lossless/arithmetic set. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** `undefined` when the bytes are not a PNG or JPEG we can read a size from. */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  return pngSize(bytes) ?? jpegSize(bytes);
}

function pngSize(bytes: Uint8Array): ImageSize | undefined {
  // 8-byte signature, then the IHDR chunk, whose first two fields are the size.
  if (bytes.length < 24) return undefined;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => bytes[i] === byte)) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
}

function jpegSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
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
    if (marker === 0xd9 || marker === 0xda) return undefined; // end, or entropy data

    const length = view.getUint16(offset + 2);
    if (SOF_MARKERS.has(marker)) {
      // length(2) precision(1) height(2) width(2), from the marker's payload.
      if (offset + 9 > bytes.length) return undefined;
      return { heightPx: view.getUint16(offset + 5), widthPx: view.getUint16(offset + 7) };
    }
    if (length < 2) return undefined; // malformed; refuse rather than loop
    offset += 2 + length;
  }
  return undefined;
}
