import { describe, expect, it } from "vitest";
import { DoctureError } from "docture";
import { inMemoryDataset, looseEval, OutOfScopeError } from "../src/index.js";
import { runEval, memoryRunStore, rescore } from "../src/runner/index.js";
import type { Dataset, EvalExtractor } from "../src/index.js";

const spec = looseEval();
const cases = Array.from({ length: 24 }, (_, i) => ({ id: `case-${i}`, documents: [], expected: { value: i } }));
const dataset = inMemoryDataset("fixture", cases);

describe("runner", () => {
  it("orders cases, experiments and epochs identically across lane counts", async () => {
    const processor: EvalExtractor = { id: "copy", async extract(item) { await new Promise(resolve => setTimeout(resolve, Math.random() * 3)); return { raw: item.expected }; } };
    for (const concurrency of [1,4,16]) {
      const result = await runEval({ dataset, spec, experiments: { a: processor, b: processor }, epochs: 2, concurrency });
      expect(result.cases.map(r => [r.caseId, r.experiment, r.epoch])).toEqual(cases.flatMap(c => ["a","b"].flatMap(e => [0,1].map(epoch => [c.id,e,epoch]))));
      expect(result.summary.a?.cases).toEqual({ total: 48, scored: 48, errored: 0, skipped: 0 });
    }
  });
  it("resumes an aborted run without repeating completed extraction", async () => {
    const controller = new AbortController(); const store = memoryRunStore(); let calls = 0; let disposed = 0;
    const processor: EvalExtractor = { id: "copy", async extract(item) { calls++; if (calls === 5) controller.abort(); return { raw: item.expected }; }, dispose() { disposed++; } };
    const first = await runEval({ dataset, spec, experiments: processor, store, signal: controller.signal });
    expect(first.run.status).toBe("aborted"); expect(first.cases).toHaveLength(5); expect(calls).toBe(5);
    const next = await runEval({ dataset, spec, experiments: processor, store, resume: first.run.id });
    expect(next.run.status).toBe("complete"); expect(next.cases).toHaveLength(24); expect(calls).toBe(24); expect(disposed).toBe(2);
    expect(next.cases[0]?.caseFingerprint).toMatch(/^[a-f0-9]{16}$/u);
    expect(next.cases[0]?.values?.["f1"]).toBe(1);
  });
  it("recognizes out-of-scope identities across copies and accounts for errors", async () => {
    class ForeignScope extends DoctureError { protected static override readonly doctureErrorIdentity = "OutOfScopeError"; readonly code = "OUT_OF_SCOPE"; readonly reason = "foreign"; }
    let disposed = 0;
    const result = await runEval({ dataset: inMemoryDataset("x", cases.slice(0,3)), spec, experiments: { id: "p", async extract(item) { if (item.id === "case-0") throw new OutOfScopeError("local"); if (item.id === "case-1") throw new ForeignScope("foreign"); throw new Error("failed"); }, dispose() { disposed++; } } });
    expect(result.cases.map(row => row.outcome)).toEqual(["skipped", "skipped", "errored"]);
    expect(result.cases[2]).toMatchObject({ omitted: { fields: 1, weight: 1 } }); expect(disposed).toBe(1);
  });
  it("disposes all experiments after preflight failure", async () => {
    let disposed = 0; let calls = 0;
    await expect(runEval({ dataset, spec, experiments: { id: "p", async preflight() { throw new Error("no key"); }, async extract() { calls++; return { raw: {} }; }, dispose() { disposed++; } } })).rejects.toThrow("no key");
    expect(disposed).toBe(1); expect(calls).toBe(0);
  });
  it("persists reporter failures as warnings and re-scores through project without extracting", async () => {
    const store = memoryRunStore(); let calls = 0;
    const result = await runEval({ dataset: inMemoryDataset("x", cases.slice(0,1)), spec, store, experiments: { id: "p", async extract() { calls++; return { raw: { value: 99 } }; } }, reporters: [{ id: "broken", onResult() { throw new Error("offline"); } }] });
    expect(result.warnings).toEqual(["Reporter broken: offline"]);
    expect((await store.readResult(result.run.id)).warnings).toEqual(result.warnings);
    const changed = await rescore(store, result.run.id, spec, { extractors: { p: { project: () => ({ value: 0 }) } } });
    expect(changed.cases[0]).toMatchObject({ actual: { value: 0 }, score: { metrics: { exact: true } } }); expect(calls).toBe(1);
  });
  it("lists unknown selected case ids", async () => {
    await expect(runEval({ dataset, spec, experiments: { id: "p", async extract() { return { raw: {} }; } }, select: { ids: ["absent", "also-absent"] } })).rejects.toThrow("absent, also-absent");
  });
  it("runs a hand-written dataset contract end to end", async () => {
    const custom: Dataset = { id: "manifest-layout", async cases() { return [{ id: "entry", documents: [], expected: { total: 42 } }]; } };
    const result = await runEval({ dataset: custom, spec, experiments: { id: "p", async extract(item) { return { raw: item.expected }; } } });
    expect(result.cases[0]).toMatchObject({ caseId: "entry", outcome: "scored", actual: { total: 42 } });
  });
});

it("invalidates only changed case fingerprints and experiment configs on resume", async () => {
  const store = memoryRunStore(); let calls = 0;
  const unfinished = { ...store, async finalize() { throw new Error("crash"); } };
  const processor: EvalExtractor = { id: "p", config: { version: 1 }, async extract(item) { calls++; return { raw: item.expected }; } };
  await expect(runEval({ dataset: inMemoryDataset("x", cases.slice(0,2)), spec, store: unfinished, experiments: processor })).rejects.toThrow("crash");
  const id = (await store.listRuns())[0]?.id ?? "";
  const changedCases = [cases[0]!, { ...cases[1]!, expected: { value: 9 } }];
  await expect(runEval({ dataset: inMemoryDataset("x", changedCases), spec, store: unfinished, experiments: processor, resume: id })).rejects.toThrow("crash");
  expect(calls).toBe(3);
  await runEval({ dataset: inMemoryDataset("x", changedCases), spec, store, experiments: { ...processor, config: { version: 2 } }, resume: id });
  expect(calls).toBe(5);
});
it("fails storage errors without relabeling them as extraction errors", async () => {
  const original = memoryRunStore();
  const store = { ...original, async writeRaw() { throw new Error("disk full"); } };
  let disposed = false;
  await expect(runEval({ dataset: inMemoryDataset("x", cases.slice(0,1)), spec, store, experiments: { id: "p", async extract(item) { return { raw: item.expected }; }, dispose() { disposed = true; } } })).rejects.toThrow("disk full");
  expect(disposed).toBe(true);
  const id = (await store.listRuns())[0]?.id;
  expect(id && (await store.openRun(id)).cases).toEqual([]);
});
it("rescores changed specs with stored confidence and evidence", async () => {
  const { defineEval, number } = await import("../src/index.js");
  const schema = { type: "object", properties: { value: { type: "number" } } };
  const strict = defineEval(schema); const lenient = defineEval(schema, { fields: { value: number({ abs: 1 }) } });
  const store = memoryRunStore(); let calls = 0;
  const result = await runEval({ dataset: inMemoryDataset("x", [{ id: "a", documents: [], expected: { value: 10 }, locations: { value: [{ pageNumber: 1 }] } }]), spec: strict, store, experiments: { id: "p", async extract() { calls++; return { raw: { value: 10.5 }, confidence: { value: 0.8 }, evidence: [{ path: "value", pageNumber: 1 }] }; } } });
  expect(result.summary.p?.overall.f1).toBe(0);
  const updated = await rescore(store, result.run.id, lenient);
  expect(updated.summary.p?.overall.f1).toBe(1); expect(calls).toBe(1);
  expect(updated.cases[0]).toMatchObject({ score: { fields: [{ confidence: 0.8, evidence: [{ pageNumber: 1 }], grounded: true }] } });
});
it("resolves a same-dataset baseline and applies analysis sections before reporters", async () => {
  const { resolveBaseline } = await import("../src/index.js");
  const store = memoryRunStore();
  const options = { dataset: inMemoryDataset("x", cases.slice(0,1)), spec, store, experiments: { id: "p", async extract(item: { expected: unknown }) { return { raw: item.expected }; } }, git: { branch: "main", sha: "abc", dirty: false } };
  const baseline = await runEval(options);
  expect(await resolveBaseline(store, { branch: "topic", fallbackBranch: "main", requireSameDataset: true, datasetFingerprint: baseline.run.dataset.fingerprint })).toBe(baseline.run.id);
  const observed: string[] = [];
  const result = await runEval({ ...options, baseline: "auto", sections: [result => { observed.push(result.run.id); return {}; }], reporters: [{ id: "report", onResult(result) { expect(observed).toEqual([result.run.id]); expect(result.comparison).toBeDefined(); } }] });
  expect(result.comparison?.compatible.dataset).toBe(true);
  expect(result.warnings).toEqual([]);
});

describe("usage of failed extractions", () => {
  const two = inMemoryDataset("x", cases.slice(0, 2));

  it("records the usage a failing processor attaches to its error and counts it in cost and tokens", async () => {
    const store = memoryRunStore();
    const paid = Object.assign(new Error("invalid paid output"), { usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125, costUsd: 2 } });
    const result = await runEval({ dataset: two, spec, store, experiments: { id: "p", async extract(item) {
      if (item.id === "case-1") throw paid;
      return { raw: item.expected, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5 } };
    } } });
    expect(result.cases[1]).toMatchObject({ outcome: "errored", error: { message: "invalid paid output" }, usage: { inputTokens: 100, outputTokens: 25, costUsd: 2 } });
    expect(result.cases[1]?.usage).toEqual({ inputTokens: 100, outputTokens: 25, costUsd: 2 });
    expect(result.summary.p?.overall).toMatchObject({ costUsd: 2.5, tokens: 127 });
    expect((await store.readResult(result.run.id)).cases[1]?.usage).toEqual({ inputTokens: 100, outputTokens: 25, costUsd: 2 });
  });

  it("ignores invalid usage on a thrown error and says so in the errored row", async () => {
    const result = await runEval({ dataset: two, spec, experiments: { id: "p", async extract() {
      throw Object.assign(new Error("failed"), { usage: { costUsd: Number.NaN } });
    } } });
    expect(result.cases[0]).toMatchObject({ outcome: "errored", error: { message: "failed (usage ignored: usage.costUsd must be a finite number)" } });
    expect(result.cases[0]?.usage).toBeUndefined();
    expect(result.summary.p?.overall["costUsd"]).toBeNull();
  });
});
