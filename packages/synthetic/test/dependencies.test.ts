import { describe, expect, it } from "vitest";
import { canonicalDependency } from "../src/dependencies.js";

describe("declared input identity", () => {
  it("ignores record insertion order and preserves array order and value types", () => {
    expect(canonicalDependency({ b: { z: 1, a: 2 }, a: [1, "2"] })).toBe(canonicalDependency({ a: [1, "2"], b: { a: 2, z: 1 } }));
    expect(canonicalDependency([1, 2])).not.toBe(canonicalDependency([2, 1]));
    expect(canonicalDependency(1)).not.toBe(canonicalDependency("1"));
    expect(canonicalDependency(-0)).toBe(canonicalDependency(0));
  });

  it("distinguishes byte inputs from arrays and records", () => {
    expect(canonicalDependency(new Uint8Array([1, 2]))).not.toBe(canonicalDependency([1, 2]));
    expect(canonicalDependency(new Uint8Array([1, 2]))).not.toBe(canonicalDependency({ bytes: [1, 2] }));
    expect(canonicalDependency(new Uint8Array([1, 2]))).not.toBe(canonicalDependency(new Uint8Array([1, 3])));
  });

  it("rejects custom byte properties and iterator accessors without evaluating them", () => {
    const extra = Object.assign(new Uint8Array([1, 2]), { label: "logo" });
    expect(() => canonicalDependency(extra)).toThrow(/byte/u);
    let reads = 0;
    const bytes = new Uint8Array([1, 2]);
    Object.defineProperty(bytes, Symbol.iterator, { get() { reads++; return Uint8Array.prototype[Symbol.iterator]; } });
    expect(() => canonicalDependency(bytes)).toThrow(TypeError);
    expect(reads).toBe(0);
  });

  it("accepts repeated finite records and rejects cycles, lossy values and getters", () => {
    const shared = { value: 1 };
    expect(() => canonicalDependency([shared, shared])).not.toThrow();
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const invalid: unknown[] = [cycle, undefined, () => 1, Symbol("id"), 1n, Number.NaN, Infinity, new Date(), new Map(), new Array(2)];
    for (const item of invalid) expect(() => canonicalDependency(item)).toThrow(TypeError);
    let reads = 0;
    expect(() => canonicalDependency({ get value() { reads++; return 1; } })).toThrow(/data properties/u);
    expect(reads).toBe(0);
    expect(() => canonicalDependency({ [Symbol("hidden")]: 1 })).toThrow(/keys must be strings/u);
  });
});
