import type { LayoutBox } from "docture";

/** A 3x3 row-major homography from source page points to degraded page points. */
export type Matrix = readonly [number, number, number, number, number, number, number, number, number];

type Point = readonly [x: number, y: number];

export const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function isIdentity(m: Matrix): boolean {
  return m.every((value, index) => value === IDENTITY[index]);
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!);
    }
  }
  return normalize(out);
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0) throw new RangeError("The page transform is singular");
  return normalize([A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((value) => value / det));
}

/** Scale so the last entry is 1, and turn `-0` into `0` so equal transforms compare equal. */
function normalize(values: readonly number[]): Matrix {
  const w = values[8] as number;
  return values.map((value) => {
    const scaled = value / w;
    return scaled === 0 ? 0 : scaled;
  }) as unknown as Matrix;
}

export function apply(m: Matrix, [x, y]: Point): Point {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** The box's corners through `matrix`, then their axis-aligned bounding box. */
export function transformBox(matrix: Matrix, box: LayoutBox): LayoutBox {
  if (isIdentity(matrix)) return box;
  const corners = [
    apply(matrix, [box.x, box.y]),
    apply(matrix, [box.x + box.width, box.y]),
    apply(matrix, [box.x + box.width, box.y + box.height]),
    apply(matrix, [box.x, box.y + box.height]),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function translation(dx: number, dy: number): Matrix {
  return normalize([1, 0, dx, 0, 1, dy, 0, 0, 1]);
}

export function rotationAbout(degrees: number, [cx, cy]: Point): Matrix {
  if (degrees === 0) return IDENTITY;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return normalize([cos, -sin, cx - cos * cx + sin * cy, sin, cos, cy - sin * cx - cos * cy, 0, 0, 1]);
}

export function shearAbout(factor: number, [, cy]: Point): Matrix {
  return normalize([1, factor, -factor * cy, 0, 1, 0, 0, 0, 1]);
}

/** The homography that sends each of four points to its target. */
export function fromCorners(from: readonly Point[], to: readonly Point[]): Matrix {
  if (from.every(([x, y], index) => x === to[index]?.[0] && y === to[index]?.[1])) return IDENTITY;
  const rows: number[][] = [];
  from.forEach(([x, y], index) => {
    const [u, v] = to[index] as Point;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = row;
    [rows[col], rows[pivot]] = [rows[pivot]!, rows[col]!];
    const lead = rows[col]!;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const target = rows[row]!;
      const factor = target[col]! / lead[col]!;
      for (let k = col; k < 9; k++) target[k]! -= factor * lead[k]!;
    }
  }
  return normalize([...rows.map((row, index) => row[8]! / row[index]!), 1]);
}

/** An 8-bit image in row-major interleaved channels. */
export interface RawImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

/**
 * Resample `image` through `matrix` (page points) by inverse mapping with bilinear sampling.
 * `scale` is pixels per point; pixels the source does not cover take `fill`.
 */
export function warp(image: RawImage, matrix: Matrix, scale: number, fill: readonly number[]): RawImage {
  if (isIdentity(matrix)) return image;
  const { width, height, channels, data } = image;
  const toPoints: Matrix = [1 / scale, 0, 0.5 / scale, 0, 1 / scale, 0.5 / scale, 0, 0, 1];
  const toPixels: Matrix = [scale, 0, -0.5, 0, scale, -0.5, 0, 0, 1];
  const m = multiply(toPixels, multiply(invert(matrix), toPoints));
  const out = new Uint8Array(width * height * channels);
  const sample = new Float64Array(channels);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const w = m[6] * u + m[7] * v + m[8];
      const sx = (m[0] * u + m[1] * v + m[2]) / w;
      const sy = (m[3] * u + m[4] * v + m[5]) / w;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      sample.fill(0);
      for (let k = 0; k < 4; k++) {
        const x = x0 + (k & 1);
        const y = y0 + (k >> 1);
        const weight = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy);
        if (weight === 0) continue;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          for (let c = 0; c < channels; c++) sample[c]! += weight * fill[c]!;
        } else {
          const at = (y * width + x) * channels;
          for (let c = 0; c < channels; c++) sample[c]! += weight * data[at + c]!;
        }
      }
      const at = (v * width + u) * channels;
      for (let c = 0; c < channels; c++) out[at + c] = Math.round(sample[c]!);
    }
  }
  return { data: out, width, height, channels };
}
