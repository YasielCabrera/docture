/**
 * TIFF for PaddleOCR. The engine decodes images with `@napi-rs/canvas`, which
 * crashes the process on TIFF bytes, so TIFF pages are decoded here with utif2 and
 * re-encoded as PNG before the engine sees them.
 */

import * as zlib from "node:zlib";
import { importEngine, lazyEngine } from "../../core/engines.js";
import { MAX_TIFF_PAGE_PIXELS, unlinkedTiff, type TiffPixelData } from "../../core/domain/tiff.js";
import { tiffPages, type TiffPage } from "../../core/index.js";

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

interface UtifIfd {
  width?: number;
  height?: number;
  data?: Uint8Array;
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
  const pages = tiffPages(bytes);
  if (pages === undefined) {
    throw new Error(`paddleocr: these bytes are not a readable TIFF (${mimeType}).`);
  }
  for (const page of pages) {
    if (!TIFF_COMPRESSIONS.has(page.compression)) {
      const supported = [...TIFF_COMPRESSIONS].map(([code, name]) => `${name} (${code})`).join(", ");
      throw new Error(
        `paddleocr: TIFF page ${page.pageNumber} uses compression ${page.compression}, ` +
          `which this loader does not read. Supported: ${supported}.`,
      );
    }
    if (page.widthPx * page.heightPx > MAX_TIFF_PAGE_PIXELS) {
      throw new Error(
        `paddleocr: TIFF page ${page.pageNumber} is ${page.widthPx}x${page.heightPx} pixels, ` +
          `more than the ${MAX_TIFF_PAGE_PIXELS} this loader decodes.`,
      );
    }
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
    const what = `TIFF page ${page.pageNumber}`;
    if (ifd === undefined) throw new Error(`paddleocr: utif2 could not read ${what}.`);
    if (DEFLATE_COMPRESSIONS.has(page.compression)) inflateWithinLayout(unlinked.bytes, unlinked.pixelData[page.pageNumber - 1]!);
    const rgba = decoded(() => {
      utif.decodeImage(buffer, ifd);
      return utif.toRGBA8(ifd);
    }, what);
    delete ifd.data;
    if (ifd.width !== page.widthPx || ifd.height !== page.heightPx || rgba.length !== page.widthPx * page.heightPx * 4) {
      throw new Error(`paddleocr: ${what} did not decode to its declared ${page.widthPx}x${page.heightPx} pixels.`);
    }
    pngs.push(encodePng(rgba, page.widthPx, page.heightPx));
  }
  return pngs;
}

/**
 * Inflate each strip or tile of a Deflate page, as utif2 is about to, but refuse
 * output beyond what the page layout holds, so a few hundred KB cannot inflate to
 * gigabytes inside utif2.
 */
function inflateWithinLayout(bytes: Uint8Array, data: TiffPixelData): void {
  let pageBytes = 0;
  try {
    for (const { offset, byteCount } of data.chunks) {
      if (byteCount < 6) throw new Error(`a Deflate strip of ${byteCount} bytes has no room for its zlib framing`);
      // The raw stream inside the zlib framing, the bytes utif2 hands to pako.inflateRaw.
      const stream = bytes.subarray(offset + 2, offset + byteCount - 4);
      pageBytes += zlib.inflateRawSync(stream, {
        maxOutputLength: data.maxChunkBytes,
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      }).length;
      if (pageBytes > data.maxPageBytes) throw new Error(`Deflate strips inflate past the page's ${data.maxPageBytes} bytes`);
    }
  } catch (error) {
    throw new Error("paddleocr: these bytes are not a readable TIFF.", { cause: error });
  }
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

function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const scanlines = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    scanlines.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  ]));
}
