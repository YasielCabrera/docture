import { describe, expect, it, vi } from "vitest";
import { defineEval, GroundTruthError, inMemoryDataset, looseEval, MigrationGuardError, PreflightError, type EvalCase, type WritableDataset } from "../src/index.js";
import { sample, runMigration, defineMigration, draftExpected, caseFingerprint, datasetFingerprint } from "../src/dataset/index.js";
const cases = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, documents: [], expected: { value: i }, tags: { stratum: i % 3 }, group: `g${Math.floor(i/2)}` }));
it("samples nested prefixes with stable ordering independent of discovery", () => {
  const options = { strata: (item: EvalCase<{ value: number }>) => String(item.tags?.stratum), seed: "seed" };
  const small = sample(cases, { ...options, size: 30 }); const large = sample(cases, { ...options, size: 60 });
  expect(small).toHaveLength(30); expect(large).toHaveLength(60);
  expect(small.every(item => large.includes(item))).toBe(true);
  expect(sample([...cases].reverse(), { ...options, size: 30 }).map(c => c.id).sort()).toEqual(small.map(c => c.id).sort());
  const grouped = sample(cases, { size: 31, keepGroups: true });
  expect(grouped).toHaveLength(32); expect(grouped.every(item => grouped.filter(other => other.group === item.group).length === 2)).toBe(true);
  expect(datasetFingerprint(cases)).toBe(datasetFingerprint([...cases].reverse()));
  expect(caseFingerprint(cases[0]!)).not.toBe(caseFingerprint({ ...cases[0]!, expected: { value: -1 } }));
});
it("previews migrations, rejects untargeted and non-idempotent changes, and writes only on request", async () => {
  const writes: unknown[] = [];
  const dataset: WritableDataset<{ value: number }> = { ...inMemoryDataset("x", cases.slice(0,2)), async writeExpected(id, value, options) { writes.push({ id, value, ...options }); }, async signOff() {} };
  const migration = defineMigration({ id: "normalize", description: "normalize", targets: ["value"], apply: () => ({ value: 42 }) });
  const preview = await runMigration(dataset, migration, { spec: looseEval() });
  expect(preview.cases[0]?.diff).toEqual([{ path: "value", before: 0, after: 42 }]); expect(writes).toEqual([]);
  await runMigration(dataset, migration, { write: true }); expect(writes).toHaveLength(2);
  const untargeted = await runMigration(dataset, { ...migration, targets: ["other"] }).catch((e: unknown) => e);
  expect(untargeted).toBeInstanceOf(MigrationGuardError); expect(untargeted).toMatchObject({ caseId: "c0", paths: ["value"] });
  const repeated = await runMigration(dataset, { ...migration, apply: expected => ({ value: expected.value + 1 }) }).catch((e: unknown) => e);
  expect(repeated).toBeInstanceOf(MigrationGuardError); expect(repeated).toMatchObject({ caseId: "c0", paths: ["value"] });
});

describe("sample", () => {
  const options = { size: 20, seed: "s", strata: (item: EvalCase<{ value: number }>) => String(item.tags?.stratum) };
  it("keeps every previously sampled case when new cases join a stratum", () => {
    const grown = [...cases, ...Array.from({ length: 50 }, (_, i) => ({ id: `new${i}`, documents: [], expected: { value: i }, tags: { stratum: i % 3 } }))];
    const before = sample(cases, { ...options, size: 30 }).map(item => item.id);
    const after = new Set(sample(grown, { ...options, size: 45 }).map(item => item.id));
    expect(before.filter(id => !after.has(id))).toEqual([]);
  });
  it("orders ids and strata by code unit whatever the host collation", () => {
    const items = ["z", "ä", "i", "y", "ch", "h", "😀a", "😀b"].map(id => ({ id, documents: [], expected: 1, tags: { stratum: id } }));
    const expected = { fingerprint: datasetFingerprint(items), sampled: sample(items, { size: 4, seed: "", strata: item => String(item.tags?.stratum) }).map(item => item.id) };
    const collation = vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (this: string, other: string) { return this < other ? 1 : this > other ? -1 : 0; });
    try {
      expect({ fingerprint: datasetFingerprint(items), sampled: sample(items, { size: 4, seed: "", strata: item => String(item.tags?.stratum) }).map(item => item.id) }).toEqual(expected);
    } finally { collation.mockRestore(); }
  });
  it("ranks ids that differ only in an astral character's low surrogate apart", () => {
    const items = ["😀", "😁", "😂", "😃", "😄", "😅", "😆", "😇"].map(id => ({ id, documents: [], expected: 1 }));
    const orders = new Set(["a", "b", "c", "d", "e"].map(seed => sample(items, { size: 1, seed })[0]?.id));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("caseFingerprint", () => {
  it("changes when expected locations change", () => {
    const item = { id: "a", documents: [], expected: 1, locations: { total: [{ pageNumber: 1 }] } };
    expect(caseFingerprint(item)).not.toBe(caseFingerprint({ ...item, locations: { total: [{ pageNumber: 2 }] } }));
  });
});

function recordingDataset<T>(items: readonly EvalCase<T>[]) {
  const writes: { id: string; value: T; draft: boolean }[] = [];
  const dataset: WritableDataset<T> = { ...inMemoryDataset("rec", items), async writeExpected(id, value, options) { writes.push({ id, value, draft: options.draft }); }, async signOff() {} };
  return { dataset, writes };
}

describe("runMigration", () => {
  it("writes migrated values back as drafts for cases that were drafts", async () => {
    const { dataset, writes } = recordingDataset([{ id: "signed", documents: [], expected: { total: 1 } }, { id: "pending", documents: [], expected: { total: 1 }, status: "draft" as const }]);
    await runMigration(dataset, defineMigration({ id: "m", description: "", targets: ["total"], apply: () => ({ total: 2 }) }), { write: true });
    expect(writes).toEqual([{ id: "signed", value: { total: 2 }, draft: false }, { id: "pending", value: { total: 2 }, draft: true }]);
  });
  it("rejects an invalid target before reading any case, naming no case", async () => {
    const { dataset } = recordingDataset([{ id: "a", documents: [], expected: { total: 1 } }]);
    const error = await runMigration(dataset, defineMigration({ id: "m", description: "", targets: ["total[["], apply: (expected) => expected })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationGuardError);
    expect(error).toMatchObject({ migration: "m", paths: ["total[["] });
    expect(Object.hasOwn(error as object, "caseId")).toBe(false);
  });
  it("accepts array item patterns as targets and rejects siblings outside them", async () => {
    const { dataset, writes } = recordingDataset([{ id: "a", documents: [], expected: { lineItems: [{ amount: "1", sku: "x" }, { amount: "2", sku: "y" }] } }]);
    const toNumber = defineMigration<{ lineItems: { amount: string | number; sku: string }[] }>({ id: "amounts", description: "", targets: ["lineItems[].amount"], apply: expected => ({ lineItems: expected.lineItems.map(item => ({ ...item, amount: Number(item.amount) })) }) });
    const report = await runMigration(dataset, toNumber, { write: true });
    expect(report.cases[0]?.diff).toEqual([{ path: "lineItems[0].amount", before: "1", after: 1 }, { path: "lineItems[1].amount", before: "2", after: 2 }]);
    expect(writes).toEqual([{ id: "a", value: { lineItems: [{ amount: 1, sku: "x" }, { amount: 2, sku: "y" }] }, draft: false }]);
    const error = await runMigration(dataset, { ...toNumber, apply: expected => ({ lineItems: expected.lineItems.map(item => ({ ...item, sku: item.sku.toUpperCase() })) }) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationGuardError);
    expect(error).toMatchObject({ migration: "amounts", caseId: "a", paths: ["lineItems[0].sku", "lineItems[1].sku"] });
  });
  it("writes nothing when the migrated value of any case fails the spec", async () => {
    const spec = defineEval({ type: "object", properties: { total: { type: "number" } }, required: ["total"], additionalProperties: false });
    const { dataset, writes } = recordingDataset(["ok", "bad", "worse"].map(id => ({ id, documents: [], expected: { total: 1 } })));
    const migration = defineMigration<{ total: unknown }>({ id: "m", description: "", targets: ["total"], apply: (expected, item) => ({ total: item.id === "ok" ? 2 : "x" }) });
    const error = await runMigration(dataset, migration, { write: true, spec }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GroundTruthError);
    expect(error).toMatchObject({ caseIds: ["bad", "worse"], cases: [{ caseId: "bad", issues: [{ path: "total" }] }, { caseId: "worse", issues: [{ path: "total" }] }] });
    expect(writes).toEqual([]);
  });
});

describe("draftExpected", () => {
  it("drafts only cases without signed-off truth from a plain writable dataset", async () => {
    const { dataset, writes } = recordingDataset([{ id: "signed", documents: [], expected: { total: 1 } }, { id: "draft", documents: [], expected: { total: 1 }, status: "draft" as const }]);
    const drafted = await draftExpected(dataset, { id: "p", async extract() { return { raw: { total: 9 } }; } });
    expect(drafted).toEqual(["draft"]);
    expect(writes).toEqual([{ id: "draft", value: { total: 9 }, draft: true }]);
  });
  it("drafts pending cases a dataset lists separately", async () => {
    const { dataset, writes } = recordingDataset<{ total: number }>([{ id: "signed", documents: [], expected: { total: 1 } }]);
    const seen: unknown[] = [];
    const draftable = { ...dataset, async pendingCases() { return [{ id: "new", documents: [] }]; } };
    const drafted = await draftExpected(draftable, { id: "p", async extract(item) { seen.push(item.expected); return { raw: { total: 3 } }; } });
    expect(drafted).toEqual(["new"]);
    expect(seen).toEqual([undefined]);
    expect(writes).toEqual([{ id: "new", value: { total: 3 }, draft: true }]);
  });
  it("wraps a failed preflight with the processor id and writes nothing", async () => {
    const { dataset, writes } = recordingDataset([{ id: "draft", documents: [], expected: { total: 1 }, status: "draft" as const }]);
    const failure = new Error("no key");
    const error = await draftExpected(dataset, { id: "p", async preflight() { throw failure; }, async extract() { return { raw: {} }; } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreflightError);
    expect(error).toMatchObject({ experiment: "p", cause: failure });
    expect(writes).toEqual([]);
  });
});
