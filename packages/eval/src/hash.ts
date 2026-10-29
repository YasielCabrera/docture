import { canonicalJson } from "./json.js";

/**
 * A stable 64-bit FNV-1a fingerprint of a value's canonical JSON, as 16 hex
 * digits. Equal values hash equally across processes and platforms, so specs,
 * datasets and experiment configs can be compared between saved runs.
 */
export function fingerprintOf(value: unknown): string {
  return fnv1a64(canonicalJson(value));
}

// Four 16-bit limbs keep every intermediate product inside 2^53.
function fnv1a64(text: string): string {
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  for (const byte of new TextEncoder().encode(text)) {
    h0 ^= byte;
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + h0 * 0x100 + (t1 >>> 16);
    const t3 = h3 * 0x1b3 + h1 * 0x100 + (t2 >>> 16);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  return [h3, h2, h1, h0].map((limb) => limb.toString(16).padStart(4, "0")).join("");
}
