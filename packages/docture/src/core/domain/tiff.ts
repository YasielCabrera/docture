import type { ImageSize } from "./image.js";

/** One image file directory (page) of a classic TIFF. */
export interface TiffPage extends ImageSize {
  /** 1-based position in the IFD chain. */
  readonly pageNumber: number;
  /** Byte offset of this page's IFD; a copy of the file whose header points here reads as this page. */
  readonly ifdOffset: number;
  readonly littleEndian: boolean;
  /** TIFF Compression tag value: 1 none, 3 CCITT G3, 4 CCITT G4, 5 LZW, 8 Deflate, 32773 PackBits. */
  readonly compression: number;
}

const TAG_WIDTH = 256;
const TAG_HEIGHT = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC = 262;
const TAG_STRIP_OFFSETS = 273;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_ROWS_PER_STRIP = 278;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_TILE_WIDTH = 322;
const TAG_TILE_LENGTH = 323;
const TAG_TILE_OFFSETS = 324;
const TAG_TILE_BYTE_COUNTS = 325;
const TAG_CANON_SRAW = 50885;
const READ_TAGS = new Set([
  TAG_WIDTH, TAG_HEIGHT, TAG_BITS_PER_SAMPLE, TAG_COMPRESSION, TAG_PHOTOMETRIC,
  TAG_STRIP_OFFSETS, TAG_SAMPLES_PER_PIXEL, TAG_ROWS_PER_STRIP, TAG_STRIP_BYTE_COUNTS,
  TAG_TILE_WIDTH, TAG_TILE_LENGTH, TAG_TILE_OFFSETS, TAG_TILE_BYTE_COUNTS, TAG_CANON_SRAW,
]);
/** Color filter array: camera raw, for which utif2 derives bits per pixel from the strip byte count. */
const PHOTOMETRIC_CFA = 32803;
/** Four 16-bit samples, as in 16-bit RGBA. */
const MAX_BITS_PER_PIXEL = 64;
/** Tile area allowed on any page, so the 256 to 1024 pixel tiles writers default to fit a smaller page. */
const TILE_AREA_FLOOR = 1024 * 1024;
/**
 * Tags whose values are offsets of further IFDs: SubIFDs, Exif, GPS, DNG private
 * data and Fuji RAF. A decoder that follows them (utif2 does, recursively and
 * without a limit) can be made to read millions of IFDs from a few hundred bytes.
 */
const LINK_TAGS = new Set([330, 34665, 34853, 50740, 61440]);
/** Any tag no decoder interprets, written over a link tag to cut the link. */
const UNLINKED_TAG = 65535;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
/** Bytes per value of each TIFF 6 field type, indexed by type code. Other codes are skipped, as the spec asks. */
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

export const MAX_TIFF_PAGE_PIXELS = 8192 * 8192;

export const MAX_TIFF_PAGE_BYTES = 8192 * 8192 * 4;

export function tiffPageTooLarge(page: TiffPage, data: TiffPixelData): string | undefined {
  const size = `TIFF page ${page.pageNumber} is ${page.widthPx}x${page.heightPx} pixels`;
  if (page.widthPx * page.heightPx > MAX_TIFF_PAGE_PIXELS) {
    return `${size}, more than the ${MAX_TIFF_PAGE_PIXELS} this loader decodes.`;
  }
  if (data.decodedBytes > MAX_TIFF_PAGE_BYTES) {
    return `${size} whose samples decode to ${data.decodedBytes} bytes, more than the ${MAX_TIFF_PAGE_BYTES} this loader decodes.`;
  }
  return undefined;
}

/**
 * The pages of a classic (32-bit offset) TIFF, read from its IFD chain without
 * decoding pixels.
 *
 * `undefined` unless every page is well formed: the chain must not loop, IFDs must
 * not overlap, every IFD, entry value, strip and tile must lie inside the bytes, and
 * each page needs a non-zero width and height. A page's layout must also keep a
 * decoder's buffers proportional to the page: at most 64 bits per pixel, non-zero
 * rows per strip, tiles that cover the page and are no larger than it (or than
 * 1024 x 1024), and no camera-raw layout. BigTIFF is not recognized.
 *
 * @example
 * ```ts
 * import { tiffPages } from "docture";
 * const pages = tiffPages(bytes);
 * console.log(pages?.map((page) => `${page.pageNumber}: ${page.widthPx}x${page.heightPx}`));
 * ```
 */
export function tiffPages(bytes: Uint8Array): readonly TiffPage[] | undefined {
  return readTiff(bytes)?.pages;
}

/** One strip or tile as stored in the file. */
export interface TiffChunk {
  readonly offset: number;
  readonly byteCount: number;
}

/** The stored pixel data of one page, with the most bytes its layout lets it decode to. */
export interface TiffPixelData {
  /** The strips, or the tiles covering the page, that a decoder reads, in order. */
  readonly chunks: readonly TiffChunk[];
  /** Bytes in one full strip of rows or one full tile. */
  readonly maxChunkBytes: number;
  /** Bytes in the strips or tiles that cover the page. */
  readonly maxPageBytes: number;
  readonly decodedBytes: number;
}

export function tiffLayout(
  bytes: Uint8Array,
): { readonly pages: readonly TiffPage[]; readonly pixelData: readonly TiffPixelData[] } | undefined {
  const tiff = readTiff(bytes);
  return tiff === undefined ? undefined : { pages: tiff.pages, pixelData: tiff.pixelData };
}

/**
 * A copy of a TIFF that {@link tiffPages} accepts, with every link from a page to
 * another IFD retagged, so a decoder that follows links reads only the page chain,
 * and the pixel data of each page, indexed by page number less one.
 */
export function unlinkedTiff(
  bytes: Uint8Array,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly pixelData: readonly TiffPixelData[] } | undefined {
  const tiff = readTiff(bytes);
  if (tiff === undefined) return undefined;
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  for (const entry of tiff.links) view.setUint16(entry, UNLINKED_TAG, tiff.pages[0]!.littleEndian);
  return { bytes: copy, pixelData: tiff.pixelData };
}

function readTiff(
  bytes: Uint8Array,
): { pages: readonly TiffPage[]; pixelData: readonly TiffPixelData[]; links: readonly number[] } | undefined {
  if (bytes.length < 8) return undefined;
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!littleEndian && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, littleEndian) !== 42) return undefined;

  const u16 = (at: number) => view.getUint16(at, littleEndian);
  const u32 = (at: number) => view.getUint32(at, littleEndian);
  const pages: TiffPage[] = [];
  const pixelData: TiffPixelData[] = [];
  const links: number[] = [];
  const ifdByteTaken = new Uint32Array(Math.ceil(bytes.length / 32));
  const takeIfdBytesUnlessShared = (from: number, to: number): boolean => {
    for (let at = from; at < to; at += 1) {
      const bit = 1 << (at & 31);
      if ((ifdByteTaken[at >>> 5]! & bit) !== 0) return false;
      ifdByteTaken[at >>> 5]! |= bit;
    }
    return true;
  };
  let valuesAllowedBeforeRefusing = bytes.length;

  const valuesAt = (entry: number): number | undefined => {
    const size = TYPE_SIZES[u16(entry + 2)] ?? 0;
    const count = u32(entry + 4);
    valuesAllowedBeforeRefusing -= size === 0 ? 0 : count;
    const start = count * size <= 4 ? entry + 8 : u32(entry + 8);
    return valuesAllowedBeforeRefusing < 0 || start + count * size > bytes.length ? undefined : start;
  };

  const values = (entry: number, start: number): number[] | undefined => {
    const type = u16(entry + 2);
    if (type !== TYPE_SHORT && type !== TYPE_LONG) return undefined;
    return Array.from({ length: u32(entry + 4) }, (_, i) =>
      type === TYPE_SHORT ? u16(start + i * 2) : u32(start + i * 4),
    );
  };

  for (let offset = u32(4); offset !== 0; ) {
    if (offset + 2 > bytes.length) return undefined;
    const count = u16(offset);
    const end = offset + 2 + count * 12;
    if (count === 0 || end + 4 > bytes.length || !takeIfdBytesUnlessShared(offset, end + 4)) return undefined;

    const tags = new Map<number, number[] | undefined>();
    for (let entry = offset + 2; entry < end; entry += 12) {
      const start = valuesAt(entry);
      if (start === undefined) return undefined;
      const tag = u16(entry);
      if (READ_TAGS.has(tag)) tags.set(tag, values(entry, start));
      if (LINK_TAGS.has(tag)) links.push(entry);
    }

    const widthPx = tags.get(TAG_WIDTH)?.[0] ?? 0;
    const heightPx = tags.get(TAG_HEIGHT)?.[0] ?? 0;
    const compression = tags.has(TAG_COMPRESSION) ? tags.get(TAG_COMPRESSION)?.[0] : 1;
    const tiled = tags.has(TAG_TILE_WIDTH) || tags.has(TAG_TILE_LENGTH);
    const starts = tags.get(tiled ? TAG_TILE_OFFSETS : TAG_STRIP_OFFSETS) ?? [];
    const lengths = tags.get(tiled ? TAG_TILE_BYTE_COUNTS : TAG_STRIP_BYTE_COUNTS) ?? [];
    if (widthPx === 0 || heightPx === 0 || compression === undefined) return undefined;
    if (starts.length === 0 || starts.length !== lengths.length) return undefined;
    if (starts.some((start, i) => start + (lengths[i] ?? 0) > bytes.length)) return undefined;
    const layout = decodedLayout(tags, widthPx, heightPx, tiled ? starts.length : undefined);
    if (layout === undefined) return undefined;

    pages.push({ pageNumber: pages.length + 1, widthPx, heightPx, ifdOffset: offset, littleEndian, compression });
    pixelData.push({
      chunks: starts.slice(0, tiled ? layout.chunksCoveringPage : starts.length).map((start, i) => ({ offset: start, byteCount: lengths[i]! })),
      maxChunkBytes: layout.chunkBytes,
      maxPageBytes: layout.chunkBytes * layout.chunksCoveringPage,
      decodedBytes: layout.rowBytes * heightPx,
    });
    offset = u32(end);
  }
  return pages.length === 0 ? undefined : { pages, pixelData, links };
}

/**
 * The decoded size of this page's strips or tiles, or `undefined` unless the
 * buffers a decoder sizes from its tags, before reading any pixel data, stay
 * proportional to the page: utif2 allocates the page at its bits per pixel plus one
 * tile, and loops over every tile the page spans.
 */
function decodedLayout(
  tags: ReadonlyMap<number, readonly number[] | undefined>,
  widthPx: number,
  heightPx: number,
  tileCount: number | undefined,
): { chunkBytes: number; chunksCoveringPage: number; rowBytes: number } | undefined {
  const field = (tag: number, fallback: number) => (tags.has(tag) ? (tags.get(tag)?.[0] ?? 0) : fallback);
  const sampleBits = tags.has(TAG_BITS_PER_SAMPLE) ? (tags.get(TAG_BITS_PER_SAMPLE) ?? []) : [1];
  const bitsPerPixel = sampleBits.reduce((max, bits) => Math.max(max, bits), 0) * field(TAG_SAMPLES_PER_PIXEL, 1);
  if (bitsPerPixel === 0 || bitsPerPixel > MAX_BITS_PER_PIXEL) return undefined;
  if (field(TAG_PHOTOMETRIC, 0) === PHOTOMETRIC_CFA || tags.has(TAG_CANON_SRAW)) return undefined;
  const rowBytes = (pixels: number) => Math.ceil((pixels * bitsPerPixel) / 8);
  if (tileCount === undefined) {
    const rowsPerStrip = Math.min(field(TAG_ROWS_PER_STRIP, 0xffffffff), heightPx);
    if (rowsPerStrip === 0) return undefined;
    return {
      chunkBytes: rowBytes(widthPx) * rowsPerStrip,
      chunksCoveringPage: Math.ceil(heightPx / rowsPerStrip),
      rowBytes: rowBytes(widthPx),
    };
  }

  const tileWidth = field(TAG_TILE_WIDTH, 0);
  const tileLength = field(TAG_TILE_LENGTH, 0);
  if (tileWidth === 0 || tileLength === 0) return undefined;
  const across = Math.ceil(widthPx / tileWidth);
  const down = Math.ceil(heightPx / tileLength);
  const pageArea = widthPx * heightPx;
  // Tiles no larger than the page cover less than four times its area.
  const proportional =
    tileCount >= across * down &&
    tileWidth * tileLength <= Math.max(pageArea, TILE_AREA_FLOOR) &&
    across * tileWidth * down * tileLength <= Math.max(4 * pageArea, TILE_AREA_FLOOR);
  if (!proportional) return undefined;
  return { chunkBytes: rowBytes(tileWidth) * tileLength, chunksCoveringPage: across * down, rowBytes: rowBytes(widthPx) };
}
