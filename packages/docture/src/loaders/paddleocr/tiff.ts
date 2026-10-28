/**
 * TIFF for PaddleOCR. The engine decodes images with `@napi-rs/canvas`, which
 * crashes the process on TIFF bytes, so TIFF pages are decoded here with utif2 and
 * re-encoded as PNG before the engine sees them.
 */

import * as zlib from "node:zlib";
import { importEngine, lazyEngine } from "../../core/engines.js";
import { tiffLayout, tiffPageTooLarge, unlinkedTiff, type TiffPixelData } from "../../core/domain/tiff.js";
import type { TiffPage } from "../../core/index.js";

/** TIFF compressions utif2 decodes, each checked against a fixture. */
const TIFF_COMPRESSIONS = new Map([
  [1, "none"],
  [3, "CCITT G3"],
  [4, "CCITT G4"],
  [5, "LZW"],
  [8, "Deflate"],
  [32773, "PackBits"],
]);

/** Deflate and its old code, which utif2 inflates with no limit on the output. */
const DEFLATE_COMPRESSIONS = new Set([8, 32946]);
const TAG_COMPRESSION = "t259";
const HEADER_BYTES = 8;
const TAG_PHOTOMETRIC = "t262";
/** Photometric YCbCr, which utif2 converts in groups of rows per strip rather than row by row. */
const PHOTOMETRIC_YCBCR = 6;
const BAND_BYTES = 16 * 2 ** 20;

interface UtifIfd {
  width?: number;
  height?: number;
  data?: Uint8Array;
  [tag: `t${number}`]: unknown;
}

interface Utif {
  decode(buffer: ArrayBuffer, options: { parseMN: boolean; debug: boolean }): UtifIfd[];
  decodeImage(buffer: ArrayBuffer, ifd: UtifIfd): void;
  toRGBA8(ifd: UtifIfd): Uint8Array;
}

const loadUtif = lazyEngine(async (): Promise<Utif> => {
  // utif2 is CommonJS; Node exposes it as `default`, a bundler may not.
  const module = (await importEngine("docture/loaders/paddleocr", ["utif2"], () =>
    import("utif2"),
  )) as unknown as Partial<Utif> & { default?: Partial<Utif> };
  const resolved = typeof module.decode === "function" ? module : module.default;
  if (typeof resolved?.decode !== "function" || typeof resolved.toRGBA8 !== "function") {
    throw new Error("utif2 did not export decode; is the install intact?");
  }
  return resolved as Utif;
});

/**
 * The pages of a TIFF this loader can decode, or an error naming why not. Runs
 * before the decoder or the engine loads, so a malformed file costs neither.
 */
export function readableTiffPages(bytes: Uint8Array, mimeType: string): readonly TiffPage[] {
  const layout = tiffLayout(bytes);
  if (layout === undefined) {
    throw new Error(`paddleocr: these bytes are not a readable TIFF (${mimeType}).`);
  }
  const { pages, pixelData } = layout;
  for (const page of pages) {
    if (!TIFF_COMPRESSIONS.has(page.compression)) {
      const supported = [...TIFF_COMPRESSIONS].map(([code, name]) => `${name} (${code})`).join(", ");
      throw new Error(
        `paddleocr: TIFF page ${page.pageNumber} uses compression ${page.compression}, ` +
          `which this loader does not read. Supported: ${supported}.`,
      );
    }
    const tooLarge = tiffPageTooLarge(page, pixelData[page.pageNumber - 1]!);
    if (tooLarge !== undefined) throw new Error(`paddleocr: ${tooLarge}`);
  }
  return pages;
}

/**
 * Decode `pages` of the TIFF in `bytes`, each to PNG, in the order given. Pages
 * decode one at a time, yielding between them so an abort can land.
 */
export async function tiffPagesAsPng(
  bytes: Uint8Array,
  pages: readonly TiffPage[],
  signal: AbortSignal,
): Promise<Uint8Array[]> {
  const utif = await loadUtif();
  // A copy with its own buffer, since utif2 reads a whole ArrayBuffer and a view may
  // sit inside a larger pooled one.
  const unlinked = unlinkedTiff(bytes);
  if (unlinked === undefined) throw new Error("paddleocr: these bytes are not a readable TIFF.");
  const buffer = unlinked.bytes.buffer;
  const ifds = decoded(() => utif.decode(buffer, { parseMN: false, debug: false }), "the TIFF");
  const pngs: Uint8Array[] = [];
  for (const page of pages) {
    await new Promise(setImmediate);
    signal.throwIfAborted();
    const ifd = ifds[page.pageNumber - 1];
    if (ifd === undefined) throw new Error(`paddleocr: utif2 could not read TIFF page ${page.pageNumber}.`);
    decodeSamples(utif, unlinked.bytes, unlinked.pixelData[page.pageNumber - 1]!, ifd, page);
    let scanlines: Uint8Array;
    try {
      scanlines = pngScanlines(utif, ifd, page);
      release(ifd.data!);
    } finally {
      delete ifd.data;
    }
    pngs.push(encodePng(scanlines, page.widthPx, page.heightPx));
    release(scanlines);
  }
  return pngs;
}

/**
 * Decode a page's samples into `ifd.data`. A Deflate page is inflated once here,
 * refusing output beyond what the page layout holds, so a few hundred KB cannot
 * inflate to gigabytes. Its IFD is then retagged as uncompressed with the strips
 * pointing into the inflated bytes, so utif2 copies them instead of inflating them a
 * second time; utif2 applies the predictor and byte order after any decompression, so
 * the decoded samples are the same.
 */
function decodeSamples(utif: Utif, bytes: Uint8Array<ArrayBuffer>, data: TiffPixelData, ifd: UtifIfd, page: TiffPage): void {
  const what = `TIFF page ${page.pageNumber}`;
  if (DEFLATE_COMPRESSIONS.has(page.compression)) {
    const inflated = inflateWithinLayout(bytes, data);
    const tiled = ifd.t322 !== undefined;
    ifd[TAG_COMPRESSION] = [1];
    ifd[tiled ? "t324" : "t273"] = inflated.offsets;
    ifd[tiled ? "t325" : "t279"] = inflated.lengths;
    try {
      decoded(() => utif.decodeImage(inflated.bytes.buffer, ifd), what);
    } finally {
      release(inflated.bytes);
    }
  } else {
    decoded(() => utif.decodeImage(bytes.buffer, ifd), what);
  }
  if (ifd.width !== page.widthPx || ifd.height !== page.heightPx || ifd.data === undefined) {
    throw new Error(`paddleocr: ${what} did not decode to its declared ${page.widthPx}x${page.heightPx} pixels.`);
  }
}

function inflateWithinLayout(
  bytes: Uint8Array,
  data: TiffPixelData,
): { bytes: Uint8Array<ArrayBuffer>; offsets: number[]; lengths: number[] } {
  let inflated: Uint8Array<ArrayBuffer> | undefined;
  const offsets: number[] = [];
  const lengths: number[] = [];
  let pageBytes = 0;
  try {
    for (const { offset, byteCount } of data.chunks) {
      if (byteCount < 6) throw new Error(`a Deflate strip of ${byteCount} bytes has no room for its zlib framing`);
      // The raw stream inside the zlib framing, the bytes utif2 would hand to pako.inflateRaw.
      // One output chunk per strip, so zlib does not also hold the strip in pieces.
      const strip = zlib.inflateRawSync(bytes.subarray(offset + 2, offset + byteCount - 4), {
        maxOutputLength: data.maxChunkBytes,
        chunkSize: Math.max(zlib.constants.Z_MIN_CHUNK, data.maxChunkBytes),
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
      if (pageBytes + strip.length > data.maxPageBytes) {
        throw new Error(`Deflate strips inflate past the page's ${data.maxPageBytes} bytes`);
      }
      if (inflated === undefined || HEADER_BYTES + pageBytes + strip.length > inflated.length) {
        // The file's header goes first: utif2 reads the byte order from the buffer it decodes.
        const size = inflated === undefined ? data.decodedBytes + data.maxChunkBytes : 2 * pageBytes + strip.length;
        const grown = new Uint8Array(HEADER_BYTES + Math.min(data.maxPageBytes, size));
        grown.set(inflated?.subarray(0, HEADER_BYTES + pageBytes) ?? bytes.subarray(0, HEADER_BYTES));
        if (inflated !== undefined) release(inflated);
        inflated = grown;
      }
      inflated.set(strip, HEADER_BYTES + pageBytes);
      offsets.push(HEADER_BYTES + pageBytes);
      lengths.push(strip.length);
      pageBytes += strip.length;
      // A strip that owns its whole buffer shares it with nothing, unlike a small Buffer from Node's pool.
      if (strip.byteOffset === 0 && strip.buffer.byteLength === strip.length) release(strip);
    }
  } catch (error) {
    throw new Error("paddleocr: these bytes are not a readable TIFF.", { cause: error });
  }
  return { bytes: inflated!, offsets, lengths };
}

function decoded<T>(decode: () => T, what: string): T {
  // utif2 4.1.0 prints with console.log, on every tiled page ("==== 2 2") and under
  // NODE_ENV=development on odd tags, and stdout carries CLI JSON and MCP messages.
  // It takes no logger, and decoding is synchronous, so no other code sees the swap.
  const log = console.log;
  console.log = () => {};
  try {
    return decode();
  } catch (error) {
    throw new Error(`paddleocr: utif2 could not read ${what}.`, { cause: error });
  } finally {
    console.log = log;
  }
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** `zlib.crc32` arrived in Node 22.2; the package supports every Node 22. */
function crc32(bytes: Uint8Array): number {
  if (typeof zlib.crc32 === "function") return zlib.crc32(bytes);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(Buffer.from(type, "ascii"), 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(output.subarray(4, 8 + data.length)));
  return output;
}

function pngScanlines(utif: Utif, ifd: UtifIfd, page: TiffPage): Uint8Array {
  const samples = ifd.data!;
  const { widthPx: width, heightPx: height } = page;
  const stride = width * 4;
  const sampleRow = samples.length / height;
  const rowSeparable =
    Number.isInteger(sampleRow) && (ifd[TAG_PHOTOMETRIC] as readonly number[] | undefined)?.[0] !== PHOTOMETRIC_YCBCR;
  const bandRows = rowSeparable ? Math.max(1, Math.floor(BAND_BYTES / stride)) : height;
  const scanlines = new Uint8Array((stride + 1) * height);
  for (let top = 0; top < height; top += bandRows) {
    const rows = Math.min(bandRows, height - top);
    // A copy, not a view: utif2 reads 32-bit samples through `data.buffer` from offset 0.
    const data = rows === height ? samples : samples.slice(top * sampleRow, (top + rows) * sampleRow);
    const rgba = decoded(() => utif.toRGBA8({ ...ifd, height: rows, data }), `TIFF page ${page.pageNumber}`);
    if (rgba.length !== rows * stride) {
      throw new Error(`paddleocr: TIFF page ${page.pageNumber} did not decode to its declared ${width}x${height} pixels.`);
    }
    for (let row = 0; row < rows; row += 1) {
      scanlines.set(rgba.subarray(row * stride, (row + 1) * stride), (top + row) * (stride + 1) + 1);
    }
    release(rgba);
    if (data !== samples) release(data);
  }
  return scanlines;
}

function release(bytes: Uint8Array): void {
  (bytes.buffer as ArrayBuffer & { transfer(length: number): ArrayBuffer }).transfer(0);
}

function encodePng(scanlines: Uint8Array, width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  ]);
  // A large Buffer owns its memory and is returned as is; a small one is a view into Node's shared pool.
  return png.byteOffset === 0 && png.buffer.byteLength === png.length ? new Uint8Array(png.buffer) : new Uint8Array(png);
}
