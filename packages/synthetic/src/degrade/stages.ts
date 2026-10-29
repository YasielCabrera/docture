import type { Stream } from "../rng.js";
import { fromCorners, IDENTITY, multiply, rotationAbout, shearAbout, translation, type Matrix, type RawImage } from "./geometry.js";
import type { ResolvedKnobs, Rgb } from "./profiles.js";

/** The stream of one stage's knob on the current page. */
export type Draw = (stage: "paper" | "geometry" | "bed" | "encode", knob: string) => Stream;

const n = (value: number): string => value.toFixed(2);
const grey = (level: number): string => {
  const v = Math.round(Math.min(255, Math.max(0, level)));
  return `rgb(${v},${v},${v})`;
};

export function paperColour(knobs: ResolvedKnobs["paper"]): Rgb {
  return [255, Math.round(255 - 14 * knobs.tint), Math.round(255 - 42 * knobs.tint)];
}

/** Ageing tint, stains, folds and fibres as one SVG to multiply onto the page, or `undefined` when clean. */
export function paperOverlay(knobs: ResolvedKnobs["paper"], width: number, height: number, draw: Draw): string | undefined {
  if (knobs.tint === 0 && knobs.blotches === 0 && knobs.creases === 0 && knobs.fibre === 0) return undefined;
  const defs: string[] = [];
  const shapes: string[] = [];
  const [r, g, b] = paperColour(knobs);
  if (knobs.tint > 0) shapes.push(`<rect width="${width}" height="${height}" fill="rgb(${r},${g},${b})"/>`);
  const short = Math.min(width, height);
  const stains = draw("paper", "blotches");
  for (let i = 0; i < knobs.blotches; i++) {
    const radius = stains.float(0.03, 0.12) * short;
    defs.push(
      `<radialGradient id="b${i}"><stop offset="0" stop-color="rgb(176,140,92)" stop-opacity="${n(stains.float(0.06, 0.2))}"/><stop offset="0.7" stop-color="rgb(190,160,110)" stop-opacity="${n(stains.float(0.02, 0.08))}"/><stop offset="1" stop-color="rgb(255,255,255)" stop-opacity="0"/></radialGradient>`,
    );
    shapes.push(`<ellipse cx="${n(stains.float(0, width))}" cy="${n(stains.float(0, height))}" rx="${n(radius)}" ry="${n(radius * stains.float(0.6, 1.4))}" fill="url(#b${i})"/>`);
  }
  const folds = draw("paper", "creases");
  if (knobs.creases > 0) defs.push(`<filter id="soft"><feGaussianBlur stdDeviation="${n(short / 400)}"/></filter>`);
  for (let i = 0; i < knobs.creases; i++) {
    const horizontal = folds.chance(0.6);
    const at = folds.float(0.2, 0.8);
    const drift = folds.float(-0.02, 0.02);
    const [x1, y1, x2, y2] = horizontal ? [0, at * height, width, (at + drift) * height] : [at * width, 0, (at + drift) * width, height];
    const line = `x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"`;
    shapes.push(`<line ${line} stroke="${grey(170)}" stroke-opacity="0.35" stroke-width="${n(short / 150)}" filter="url(#soft)"/>`);
    shapes.push(`<line ${line} stroke="${grey(120)}" stroke-opacity="${n(folds.float(0.25, 0.5))}" stroke-width="${n(short / 900)}"/>`);
  }
  const fibres = draw("paper", "fibre");
  for (let i = 0; i < knobs.fibre; i++) {
    const x = fibres.float(0, width);
    const y = fibres.float(0, height);
    const length = fibres.float(0.004, 0.015) * short;
    const angle = fibres.float(0, Math.PI);
    const bend = fibres.float(-0.3, 0.3) * length;
    const dx = Math.cos(angle) * length;
    const dy = Math.sin(angle) * length;
    shapes.push(
      `<path d="M${n(x)} ${n(y)}q${n(dx / 2 - (dy / length) * bend)} ${n(dy / 2 + (dx / length) * bend)} ${n(dx)} ${n(dy)}" fill="none" stroke="${grey(fibres.float(110, 190))}" stroke-opacity="${n(fibres.float(0.08, 0.25))}" stroke-width="${n(short / 1500)}"/>`,
    );
  }
  return svg(width, height, defs, shapes);
}

/** Skew, shear, offset and perspective composed into one homography in page points. */
export function pageMatrix(knobs: ResolvedKnobs["geometry"], page: { readonly width: number; readonly height: number }, draw: Draw): Matrix {
  const centre = [page.width / 2, page.height / 2] as const;
  const signed = (knob: string, magnitude: number): number => {
    if (magnitude === 0) return 0;
    const stream = draw("geometry", knob);
    return (stream.chance(0.5) ? -1 : 1) * magnitude * stream.float(0.5, 1);
  };
  const skew = rotationAbout(signed("skew", knobs.skew), centre);
  const shear = shearAbout(signed("shear", knobs.shear), centre);
  let offset = IDENTITY;
  if (knobs.offset > 0) {
    const stream = draw("geometry", "offset");
    const angle = stream.float(0, 2 * Math.PI);
    const distance = knobs.offset * stream.float(0.5, 1);
    offset = translation(Math.cos(angle) * distance, Math.sin(angle) * distance);
  }
  let perspective = IDENTITY;
  if (knobs.perspective > 0) {
    const stream = draw("geometry", "perspective");
    const inward = (): number => knobs.perspective * stream.float(0.2, 1);
    const { width: w, height: h } = page;
    perspective = fromCorners(
      [[0, 0], [w, 0], [w, h], [0, h]],
      [
        [inward() * w, inward() * h],
        [w - inward() * w, inward() * h],
        [w - inward() * w, h - inward() * h],
        [inward() * w, h - inward() * h],
      ],
    );
  }
  return multiply(perspective, multiply(offset, multiply(skew, shear)));
}

/** Uneven light, an edge shadow, dust and streaks as one SVG to multiply onto the page, or `undefined` when clean. */
export function bedOverlay(knobs: ResolvedKnobs["bed"], width: number, height: number, scale: number, draw: Draw): string | undefined {
  if (knobs.falloff === 0 && knobs.shadow === 0 && knobs.dust === 0 && knobs.streaks === 0) return undefined;
  const defs: string[] = [];
  const shapes: string[] = [];
  if (knobs.falloff > 0) {
    const stream = draw("bed", "falloff");
    const cx = width * stream.float(0.35, 0.65);
    const cy = height * stream.float(0.35, 0.65);
    const radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
    defs.push(
      `<radialGradient id="falloff" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}"><stop offset="0.3" stop-color="${grey(255)}"/><stop offset="1" stop-color="${grey(255 * (1 - knobs.falloff))}"/></radialGradient>`,
    );
    shapes.push(`<rect width="${width}" height="${height}" fill="url(#falloff)"/>`);
  }
  if (knobs.shadow > 0) {
    const stream = draw("bed", "shadow");
    const side = stream.int(0, 3);
    const reach = stream.float(0.15, 0.4);
    const [x1, y1, x2, y2] = [
      [0, 0, reach, 0],
      [1, 0, 1 - reach, 0],
      [0, 0, 0, reach],
      [0, 1, 0, 1 - reach],
    ][side] as [number, number, number, number];
    defs.push(
      `<linearGradient id="shadow" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"><stop offset="0" stop-color="${grey(255 * (1 - knobs.shadow))}"/><stop offset="1" stop-color="${grey(255)}"/></linearGradient>`,
    );
    shapes.push(`<rect width="${width}" height="${height}" fill="url(#shadow)"/>`);
  }
  const dust = draw("bed", "dust");
  for (let i = 0; i < knobs.dust; i++) {
    shapes.push(`<circle cx="${n(dust.float(0, width))}" cy="${n(dust.float(0, height))}" r="${n(dust.float(0.25, 1.1) * scale)}" fill="${grey(dust.float(20, 90))}" fill-opacity="${n(dust.float(0.4, 0.9))}"/>`);
  }
  const streaks = draw("bed", "streaks");
  for (let i = 0; i < knobs.streaks; i++) {
    shapes.push(`<rect x="${n(streaks.float(0, width))}" width="${n(streaks.float(0.5, 2.5))}" height="${height}" fill="${grey(streaks.float(60, 160))}" fill-opacity="${n(streaks.float(0.08, 0.3))}"/>`);
  }
  return svg(width, height, defs, shapes);
}

/** A normalized line kernel for a camera-shake trail of `length` pixels, or `undefined` when shorter than 2. */
export function motionKernel(length: number, draw: Draw): { width: number; height: number; kernel: number[] } | undefined {
  const pixels = Math.round(length);
  if (pixels < 2) return undefined;
  const size = pixels % 2 === 0 ? pixels + 1 : pixels;
  const angle = draw("bed", "motionBlur").float(0, Math.PI);
  const kernel = new Array<number>(size * size).fill(0);
  const half = (size - 1) / 2;
  const steps = size * 4;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps - 0.5) * (pixels - 1);
    const x = Math.round(half + Math.cos(angle) * t);
    const y = Math.round(half + Math.sin(angle) * t);
    kernel[y * size + x]! += 1;
  }
  const total = kernel.reduce((sum, value) => sum + value, 0);
  return { width: size, height: size, kernel: kernel.map((value) => value / total) };
}

/** Add luminance noise with standard deviation `sigma` in place. */
export function addGrain(image: RawImage, sigma: number, draw: Draw): void {
  if (sigma === 0) return;
  const stream = draw("bed", "grain");
  const { data, channels } = image;
  for (let at = 0; at < data.length; at += channels) {
    const noise = (stream.next() + stream.next() + stream.next() - 1.5) * 2 * sigma;
    for (let c = 0; c < channels; c++) data[at + c] = clamp(data[at + c]! + noise);
  }
}

/** Steepen (positive) or flatten (negative) tones about mid-grey in place. */
export function applyContrast(image: RawImage, amount: number): void {
  if (amount === 0) return;
  const table = lookup((v) => 128 + (v - 128) * (1 + amount));
  for (let i = 0; i < image.data.length; i++) image.data[i] = table[image.data[i]!]!;
}

/** Blend toward luminance by `amount`, 0 to 1. Fully grey becomes one channel. */
export function desaturate(image: RawImage, amount: number): RawImage {
  if (amount === 0 || image.channels < 3) return image;
  const { data, channels, width, height } = image;
  const grey = amount >= 1;
  const out = new Uint8Array(width * height * (grey ? 1 : channels));
  for (let at = 0, i = 0; at < data.length; at += channels, i++) {
    const luma = 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
    if (grey) out[i] = clamp(luma);
    else for (let c = 0; c < channels; c++) out[at + c] = clamp(data[at + c]! + (luma - data[at + c]!) * amount);
  }
  return { data: out, width, height, channels: grey ? 1 : channels };
}

/** One channel: black below `level`, white at or above. */
export function bilevel(image: RawImage, level: number): RawImage {
  const { data, channels, width, height } = image;
  const out = new Uint8Array(width * height);
  for (let i = 0, at = 0; i < out.length; i++, at += channels) {
    const luma = channels < 3 ? data[at]! : 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
    out[i] = luma < level ? 0 : 255;
  }
  return { data: out, width, height, channels: 1 };
}

function lookup(map: (value: number) => number): Uint8Array {
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) table[v] = clamp(map(v));
  return table;
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function svg(width: number, height: number, defs: readonly string[], shapes: readonly string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${shapes.join("")}</svg>`;
}
