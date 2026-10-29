/**
 * Seeded randomness keyed by name. Every stream is derived from `(seed, key)` alone,
 * so the values at one path never depend on how many draws happened elsewhere.
 * Adding a field, a scenario or a degradation stage leaves every other stream intact.
 */

/** A deterministic random source. */
export interface Stream {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** A float in [min, max). */
  float(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  /** An independent stream for a sub-key. */
  fork(key: string): Stream;
}

/** The stream for `key` under `seed`. Equal inputs give equal sequences on every platform. */
export function streamFor(seed: number | string, key: string): Stream {
  const root = `${typeof seed}:${seed}`;
  return makeStream(root, key);
}

function makeStream(root: string, key: string): Stream {
  const [a, b, c, d] = cyrb128(`${root}\u0000${key}`);
  const next = sfc32(a, b, c, d);
  for (let i = 0; i < 12; i++) next();
  const stream: Stream = {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError(`int(${min}, ${max}) needs integer bounds with min <= max`);
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    pick(items) {
      if (items.length === 0) throw new RangeError("pick() needs at least one item");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance(probability) {
      return next() < probability;
    },
    fork(sub) {
      return makeStream(root, `${key}\u0000${sub}`);
    },
  };
  return stream;
}

function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
