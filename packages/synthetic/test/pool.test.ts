import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { valuePool, type ValuePoolOptions } from "../src/pool.js";

const Profile = z.object({
  name: z.string().trim().min(1),
  fleet: z.array(z.object({ plate: z.string(), axles: z.number().int() })),
  employees: z.string().transform(Number),
  department: z.string().default("Disposition"),
});
const input = [
  { name: " Elbe Transport ", fleet: [{ plate: "HH XX 1234", axles: 3 }], employees: "12" },
  { name: "Weser Fracht", fleet: [{ plate: "HB YY 4321", axles: 2 }], employees: "7" },
];

describe("valuePool", () => {
  it("returns inferred nested outputs, defaults and transforms on generation and cache reads", async () => {
    const cache = new Map<string, readonly unknown[]>();
    let generated = 0;
    const options = { schema: Profile, revision: "profiles-1", count: 2, source: { kind: "generate", id: "seeded-profiles", generate: () => { generated++; return input; } }, cache } satisfies ValuePoolOptions<z.output<typeof Profile>>;
    const values = await valuePool(options);
    expectTypeOf(values).toEqualTypeOf<readonly z.output<typeof Profile>[]>();
    expect(values).toEqual([
      { name: "Elbe Transport", fleet: [{ plate: "HH XX 1234", axles: 3 }], employees: 12, department: "Disposition" },
      { name: "Weser Fracht", fleet: [{ plate: "HB YY 4321", axles: 2 }], employees: 7, department: "Disposition" },
    ]);
    expect(await valuePool({ ...options, source: { kind: "cache-only", id: "seeded-profiles" } })).toEqual(values);
    expect(generated).toBe(1);
    expect([...cache.values()]).toEqual([input]);
    expect(Object.isFrozen(values)).toBe(true);
    expect(Object.isFrozen(values[0]?.fleet[0])).toBe(true);
  });

  it("accepts asynchronous refinements and reports rejected records with their paths", async () => {
    const schema = z.object({ name: z.string().refine(async value => value.length >= 3, "name is too short") });
    const base = { schema, revision: "names-1", count: 1, source: { kind: "generate", id: "names", generate: () => [{ name: "Ada" }] } } satisfies ValuePoolOptions<z.output<typeof schema>>;
    expect(await valuePool(base)).toEqual([{ name: "Ada" }]);
    await expect(valuePool({ ...base, source: { ...base.source, generate: () => [{ name: "Al" }] } })).rejects.toThrow("valuePool.source[0].name: name is too short");
  });

  it("uses source, schema, validation revision, count and dependency contents for cache identity", async () => {
    const cache = new Map<string, readonly unknown[]>();
    let calls = 0;
    const source = { kind: "generate", id: "names", generate: (count: number) => { calls++; return Array.from({ length: count }, (_, i) => `Name ${i}`); } } as const;
    const base = { schema: z.string(), revision: "1", count: 1, source, cache, dependencies: { config: { locale: "de", seed: 42 }, bytes: new Uint8Array([1, 2]) } };
    await valuePool(base);
    await valuePool({ ...base, dependencies: { bytes: new Uint8Array([1, 2]), config: { seed: 42, locale: "de" } } });
    expect(calls).toBe(1);
    await valuePool({ ...base, revision: "2" });
    await valuePool({ ...base, count: 2 });
    await valuePool({ ...base, schema: z.string().min(3) });
    await valuePool({ ...base, source: { ...source, id: "other-names" } });
    await valuePool({ ...base, dependencies: { config: { locale: "de", seed: 43 }, bytes: new Uint8Array([1, 2]) } });
    expect(calls).toBe(6);
    expect(cache.size).toBe(6);
  });

  it("rejects corrupt cache hits without generating or overwriting them", async () => {
    const cache = new Map<string, readonly unknown[]>();
    let calls = 0;
    const options = { schema: z.object({ count: z.number().int().positive() }), revision: "1", count: 1, source: { kind: "generate", id: "counts", generate: () => { calls++; return [{ count: 2 }]; } }, cache } satisfies ValuePoolOptions<{ count: number }>;
    await valuePool(options);
    const key = [...cache.keys()][0];
    if (key === undefined) throw new Error("No cache entry was written");
    cache.set(key, [{ count: -1 }]);
    await expect(valuePool(options)).rejects.toThrow("valuePool.cache[0].count");
    expect(calls).toBe(1);
    expect(cache.get(key)).toEqual([{ count: -1 }]);
  });

  it("fails offline cache misses without invoking a generator", async () => {
    await expect(valuePool({ schema: z.string(), revision: "1", count: 1, source: { kind: "cache-only", id: "missing" }, cache: new Map() })).rejects.toThrow('no cached pool for source "missing"');
  });

  it("requires exactly the requested count and distinct validated outputs", async () => {
    const base = { schema: z.object({ name: z.string().trim(), count: z.number().default(1) }), revision: "1", count: 2 };
    for (const values of [[], [{ name: "One" }], [{ name: "One" }, { name: "Two" }, { name: "Three" }]]) {
      await expect(valuePool({ ...base, source: { kind: "generate", id: "names", generate: () => values } })).rejects.toThrow("expected exactly 2 raw values");
    }
    const cache = new Map<string, readonly unknown[]>();
    await expect(valuePool({ ...base, source: { kind: "generate", id: "names", generate: () => [{ name: "One", count: 1 }, { count: 1, name: " One " }] }, cache })).rejects.toThrow("duplicates validated output at index 0");
    expect(cache.size).toBe(0);
  });

  it("takes defensive snapshots of generated records and cached raw input", async () => {
    const records = [{ name: "One", nested: { count: 3 } }];
    const cache = new Map<string, readonly unknown[]>();
    const schema = z.object({ name: z.string(), nested: z.object({ count: z.number() }) });
    const values = await valuePool({ schema, revision: "1", count: 1, source: { kind: "generate", id: "records", generate: () => records }, cache });
    records[0]!.nested.count = 9;
    expect(values).toEqual([{ name: "One", nested: { count: 3 } }]);
    expect([...cache.values()]).toEqual([[{ name: "One", nested: { count: 3 } }]]);
    expect(Object.isFrozen([...cache.values()][0])).toBe(true);
  });

  it("rejects lossy input and output records rather than caching them", async () => {
    const cache = new Map<string, readonly unknown[]>();
    const base = { revision: "1", count: 1, cache };
    for (const value of [undefined, Number.NaN, new Uint8Array([1]), new Date("2025-01-01"), { name: undefined }]) {
      await expect(valuePool({ ...base, schema: z.string(), source: { kind: "generate", id: "invalid", generate: () => [value] } })).rejects.toThrow();
    }
    await expect(valuePool({ ...base, schema: z.string().transform(() => Number.POSITIVE_INFINITY), source: { kind: "generate", id: "invalid-output", generate: () => ["one"] } })).rejects.toThrow("dependency numbers must be finite");
    expect(cache.size).toBe(0);
  });

  it("rejects non-enumerable array elements before cloning can replace them with defaults", async () => {
    const names = ["Ada"];
    Object.defineProperty(names, "0", { enumerable: false });
    const cache = new Map<string, readonly unknown[]>();
    await expect(valuePool({
      schema: z.array(z.string().default("Unknown")), revision: "1", count: 1, cache,
      source: { kind: "generate", id: "names", generate: () => [names] },
    })).rejects.toThrow("dependency arrays must contain enumerable data properties");
    expect(cache.size).toBe(0);
  });

  it("rejects invalid configuration before calling cache or generation", async () => {
    let reads = 0;
    const cache = { get: () => { reads++; return undefined; }, set: () => undefined };
    const base = { schema: z.string(), revision: "1", count: 1, source: { kind: "generate", id: "names", generate: () => ["One"] }, cache } satisfies ValuePoolOptions<string>;
    await expect(valuePool({ ...base, count: 0 })).rejects.toThrow("positive integer count");
    await expect(valuePool({ ...base, revision: " " })).rejects.toThrow("nonempty validation revision");
    await expect(valuePool({ ...base, source: { ...base.source, id: " " } })).rejects.toThrow("nonempty source id");
    await expect(valuePool({ ...base, dependencies: { invalid: Number.NaN } })).rejects.toThrow("dependency numbers must be finite");
    expect(reads).toBe(0);
  });
});
