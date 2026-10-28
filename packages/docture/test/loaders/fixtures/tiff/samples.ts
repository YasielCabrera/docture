import { deflateSync, inflateSync } from "node:zlib";

export interface SampleTiff {
  readonly width: number;
  readonly height: number;
  readonly bitsPerSample: 8 | 16;
  readonly samplesPerPixel: 1 | 4;
  readonly photometric: 1 | 2;
  readonly compression: 1 | 8;
  readonly rowsPerStrip: number;
  readonly tileSize?: number;
  readonly samples: Uint8Array;
}

export function sampleTiff(spec: SampleTiff): Uint8Array {
  const rowBytes = (spec.width * spec.samplesPerPixel * spec.bitsPerSample) / 8;
  const pixelBytes = rowBytes / spec.width;
  const stored: Uint8Array[] = [];
  const tile = spec.tileSize;
  if (tile === undefined) {
    for (let top = 0; top < spec.height; top += spec.rowsPerStrip) {
      stored.push(spec.samples.subarray(top * rowBytes, Math.min(spec.height, top + spec.rowsPerStrip) * rowBytes));
    }
  } else {
    for (let top = 0; top < spec.height; top += tile) {
      for (let left = 0; left < spec.width; left += tile) {
        const padded = new Uint8Array(tile * tile * pixelBytes);
        for (let row = 0; row < tile && top + row < spec.height; row += 1) {
          const from = (top + row) * rowBytes + left * pixelBytes;
          padded.set(spec.samples.subarray(from, from + Math.min(tile, spec.width - left) * pixelBytes), row * tile * pixelBytes);
        }
        stored.push(padded);
      }
    }
  }
  const strips = stored.map((rows) => (spec.compression === 8 ? deflateSync(rows) : rows));
  const [offsetsTag, countsTag] = tile === undefined ? [273, 279] : [324, 325];
  const SHORT = 3;
  const LONG = 4;
  type Entry = [tag: number, type: number, values: number[]];
  const layout: Entry[] = tile === undefined
    ? [[278, LONG, [spec.rowsPerStrip]]]
    : [[322, SHORT, [tile]], [323, SHORT, [tile]]];
  const entries: Entry[] = [
    [256, LONG, [spec.width]],
    [257, LONG, [spec.height]],
    [258, SHORT, Array<number>(spec.samplesPerPixel).fill(spec.bitsPerSample)],
    [259, SHORT, [spec.compression]],
    [262, SHORT, [spec.photometric]],
    [277, SHORT, [spec.samplesPerPixel]],
    [offsetsTag, LONG, []],
    [countsTag, LONG, strips.map((strip) => strip.length)],
    ...layout,
    ...(spec.samplesPerPixel === 4 ? [[338, SHORT, [2]] satisfies Entry] : []),
  ];
  entries.sort(([a], [b]) => a - b);
  const ifdBytes = 2 + entries.length * 12 + 4;
  const valueBytes = entries.reduce((sum, [tag, type]) => {
    const count = tag === offsetsTag ? strips.length : entries.find(([t]) => t === tag)![2].length;
    const size = count * (type === SHORT ? 2 : 4);
    return size > 4 ? sum + size : sum;
  }, 0);
  let stripAt = 8 + ifdBytes + valueBytes;
  const stripOffsets = strips.map((strip) => {
    const at = stripAt;
    stripAt += strip.length;
    return at;
  });
  entries.find(([tag]) => tag === offsetsTag)![2].push(...stripOffsets);

  const bytes = new Uint8Array(stripAt);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entries.length, true);
  let values = 8 + ifdBytes;
  entries.forEach(([tag, type, list], index) => {
    const entry = 10 + index * 12;
    const width = type === SHORT ? 2 : 4;
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, list.length, true);
    let target = entry + 8;
    if (list.length * width > 4) {
      view.setUint32(entry + 8, values, true);
      target = values;
      values += list.length * width;
    }
    list.forEach((value, i) => {
      if (type === SHORT) view.setUint16(target + i * 2, value, true);
      else view.setUint32(target + i * 4, value, true);
    });
  });
  view.setUint32(10 + entries.length * 12, 0, true);
  strips.forEach((strip, i) => bytes.set(strip, stripOffsets[i]!));
  return bytes;
}

export function patternSamples(length: number, seed: number): Uint8Array {
  const samples = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    samples[i] = state >>> 24;
  }
  return samples;
}

export function pngRgba(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const scanlines = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = scanlines[row * (stride + 1)];
    if (filter !== 0) throw new Error(`row ${row} uses PNG filter ${filter}`);
    rgba.set(scanlines.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)), row * stride);
  }
  return { width, height, rgba };
}
