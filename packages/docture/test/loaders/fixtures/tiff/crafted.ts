import { deflateSync } from "node:zlib";

const SHORT = 3;
const LONG = 4;
/** Every crafted file puts its first IFD right after the 8-byte header. */
export const FIRST_IFD = 8;

/** A value the builder fills in once the layout is known. */
type Placeholder =
  | { readonly at: "strip" }
  | { readonly at: "strip-length" }
  | { readonly at: "ifd"; readonly index: number };
type Value = number | Placeholder;
type Entry = readonly [tag: number, type: number, values: readonly Value[]];

const STRIP: Placeholder = { at: "strip" };
const STRIP_LENGTH: Placeholder = { at: "strip-length" };
const ifdAt = (index: number): Placeholder => ({ at: "ifd", index });

function page(width: number, height: number, compression: number, more: readonly Entry[] = []): Entry[] {
  return [
    [256, LONG, [width]], [257, LONG, [height]], [258, SHORT, [8]], [259, SHORT, [compression]],
    [262, SHORT, [1]], [273, LONG, [STRIP]], [277, SHORT, [1]], [278, LONG, [height]], [279, LONG, [STRIP_LENGTH]],
    ...more,
  ];
}

function tiff(ifds: readonly (readonly Entry[])[], pageCount: number, strip = new Uint8Array(16)): Uint8Array {
  const offsets: number[] = [];
  let at = FIRST_IFD;
  for (const entries of ifds) {
    offsets.push(at);
    at += 2 + entries.length * 12 + 4;
  }
  const width = (type: number) => (type === SHORT ? 2 : 4);
  const arrays = ifds.flat().reduce((sum, [, type, values]) => {
    const size = values.length * width(type);
    return size > 4 ? sum + size : sum;
  }, 0);
  const stripAt = at + arrays;
  const bytes = new Uint8Array(stripAt + strip.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, FIRST_IFD, true);
  bytes.set(strip, stripAt);
  const resolve = (value: Value): number => {
    if (typeof value === "number") return value;
    if (value.at === "strip") return stripAt;
    if (value.at === "strip-length") return strip.length;
    return offsets[value.index]!;
  };

  let array = at;
  ifds.forEach((entries, index) => {
    const ifd = offsets[index]!;
    view.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, values], position) => {
      const entry = ifd + 2 + position * 12;
      view.setUint16(entry, tag, true);
      view.setUint16(entry + 2, type, true);
      view.setUint32(entry + 4, values.length, true);
      let target = entry + 8;
      if (values.length * width(type) > 4) {
        target = array;
        view.setUint32(entry + 8, array, true);
        array += values.length * width(type);
      }
      values.forEach((value, i) => {
        if (type === SHORT) view.setUint16(target + i * 2, resolve(value), true);
        else view.setUint32(target + i * 4, resolve(value), true);
      });
    });
    const next = index + 1 < pageCount ? offsets[index + 1]! : 0;
    view.setUint32(ifd + 2 + entries.length * 12, next, true);
  });
  return bytes;
}

export function subIfdFanOut(depth: number): Uint8Array {
  const ifds: Entry[][] = [page(4, 4, 1, [[330, LONG, [ifdAt(1), ifdAt(1)]]])];
  for (let level = 1; level <= depth; level += 1) {
    ifds.push([[330, LONG, [ifdAt(level + 1), ifdAt(level + 1)]]]);
  }
  ifds.push([[256, LONG, [1]]]);
  return tiff(ifds, 1);
}

export function oversizedTiff(width: number, height: number): Uint8Array {
  return tiff([page(width, height, 5)], 1);
}

export function overlappingIfds(entries: number, count: number): Uint8Array {
  const base = 14;
  const slot = (k: number) => base + 2 + 12 * k;
  const size = slot(entries + count) + 64;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, base, true);
  view.setUint16(base, entries, true);
  for (let k = 0; k < count - 1; k += 1) view.setUint16(slot(k) + 10, entries, true);
  const strip = size - 16;
  const tags: [number, number, number][] = [[256, SHORT, 10], [257, SHORT, 10], [273, LONG, strip], [279, LONG, 1]];
  tags.forEach(([tag, type, value], j) => {
    const entry = slot(count + j);
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, 1, true);
    view.setUint32(entry + 8, value, true);
  });
  for (let i = 0; i < count; i += 1) {
    view.setUint32(slot(entries + i), i + 1 < count ? base + 12 * (i + 1) : 0, true);
  }
  return bytes;
}

/**
 * One uncompressed 8-bit grayscale page cut into `tileWidth` x `tileLength` tiles,
 * every tile reading the same 16 zero bytes. `tiles` defaults to the number the page spans.
 */
export function tiledTiff(width: number, height: number, tileWidth: number, tileLength: number, tiles?: number): Uint8Array {
  const count = tiles ?? Math.ceil(width / tileWidth) * Math.ceil(height / tileLength);
  return tiff([[
    [256, LONG, [width]], [257, LONG, [height]], [258, SHORT, [8]], [259, SHORT, [1]], [262, SHORT, [1]],
    [277, SHORT, [1]], [322, LONG, [tileWidth]], [323, LONG, [tileLength]],
    [324, LONG, Array<Value>(count).fill(STRIP)], [325, LONG, Array<Value>(count).fill(STRIP_LENGTH)],
  ]], 1);
}

/** A 4x4 grayscale page with one strip, with each tag in `tags` added or replaced as a single LONG. */
export function retaggedPage(tags: Readonly<Record<number, number>>): Uint8Array {
  const changes = Object.entries(tags).map(([tag, value]): Entry => [Number(tag), LONG, [value]]);
  const entries = page(4, 4, 1).filter(([tag]) => !(tag in tags));
  return tiff([[...entries, ...changes]], 1);
}

/**
 * A `width` x `height` 8-bit grayscale Deflate page whose one strip inflates to
 * `inflatedBytes` zeros, however few bytes the page declares.
 */
export function deflatedStripPage(width: number, height: number, inflatedBytes: number): Uint8Array {
  return tiff([page(width, height, 8)], 1, deflateSync(new Uint8Array(inflatedBytes), { level: 9 }));
}
