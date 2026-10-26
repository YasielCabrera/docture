import { deflateSync } from "node:zlib";
import type { PdfJsImageData } from "./pdfjs.js";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  Buffer.from(data).copy(output, 8);
  output.writeUInt32BE(crc32(new Uint8Array(output.buffer, output.byteOffset + 4, data.length + 4)), 8 + data.length);
  return new Uint8Array(output);
}

function rgbaOf(image: PdfJsImageData, imageKinds: Readonly<Record<string, number>>): Uint8Array | undefined {
  const source = image.data;
  if (source === undefined || image.width <= 0 || image.height <= 0) return undefined;
  const pixels = image.width * image.height;
  const rgba = new Uint8Array(pixels * 4);
  const rgbaKind = imageKinds.RGBA_32BPP;
  const rgbKind = imageKinds.RGB_24BPP;
  const grayKind = imageKinds.GRAYSCALE_1BPP;

  if (image.kind === rgbaKind || source.length === pixels * 4) {
    rgba.set(source.subarray(0, rgba.length));
    return rgba;
  }
  if (image.kind === rgbKind || source.length === pixels * 3) {
    for (let index = 0; index < pixels; index += 1) {
      rgba[index * 4] = source[index * 3] ?? 0;
      rgba[index * 4 + 1] = source[index * 3 + 1] ?? 0;
      rgba[index * 4 + 2] = source[index * 3 + 2] ?? 0;
      rgba[index * 4 + 3] = 255;
    }
    return rgba;
  }
  const rowBytes = Math.ceil(image.width / 8);
  if (image.kind === grayKind || source.length === rowBytes * image.height) {
    for (let index = 0; index < pixels; index += 1) {
      const row = Math.floor(index / image.width);
      const column = index % image.width;
      const value = ((source[row * rowBytes + (column >> 3)] ?? 0) & (1 << (7 - (column & 7)))) === 0 ? 0 : 255;
      rgba[index * 4] = value;
      rgba[index * 4 + 1] = value;
      rgba[index * 4 + 2] = value;
      rgba[index * 4 + 3] = 255;
    }
    return rgba;
  }
  return undefined;
}

/** Encode PDF.js's decoded image buffer as a portable PNG. */
export function pngFromPdfJsImage(
  image: PdfJsImageData,
  imageKinds: Readonly<Record<string, number>>,
): Uint8Array | undefined {
  const rgba = rgbaOf(image, imageKinds);
  if (rgba === undefined) return undefined;
  const scanlines = new Uint8Array((image.width * 4 + 1) * image.height);
  for (let row = 0; row < image.height; row += 1) {
    const target = row * (image.width * 4 + 1);
    scanlines[target] = 0;
    scanlines.set(rgba.subarray(row * image.width * 4, (row + 1) * image.width * 4), target + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(PNG_SIGNATURE),
      Buffer.from(chunk("IHDR", new Uint8Array(header))),
      Buffer.from(chunk("IDAT", new Uint8Array(deflateSync(scanlines)))),
      Buffer.from(chunk("IEND", new Uint8Array())),
    ]),
  );
}
