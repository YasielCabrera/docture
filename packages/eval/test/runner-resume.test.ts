import { describe, expect, it } from "vitest";
import { defineEval, inMemoryDataset, looseEval, number, RunStoreError, type EvalExtractor, type RunStore } from "../src/index.js";
import { memoryRunStore, runEval } from "../src/runner/index.js";

const spec = looseEval();
const cases = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, documents: [], expected: { value: i } }));
const dataset = inMemoryDataset("x", cases);

function crashingOnFinalize(store: RunStore): RunStore {
  return { ...store, async finalize() { throw new Error("crash"); } };
}

describe("resume", () => {
  it("drops cases interrupted by an abort and extracts them again on resume at any concurrency", async () => {
    const store = memoryRunStore(); const controller = new AbortController(); let calls = 0;
    const processor: EvalExtractor = { id: "p", async extract(item, context) {
      calls++;
      if (calls === 3) setTimeout(() => controller.abort(), 5);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 20);
        context.signal.addEventListener("abort", () => { clearTimeout(timer); reject(context.signal.reason); }, { once: true });
      });
      return { raw: item.expected };
    } };
    const first = await runEval({ dataset, spec, experiments: processor, store, signal: controller.signal, concurrency: 4 });
    expect(first.run.status).toBe("aborted");
    expect(first.cases).toEqual([]);
    expect((await store.openRun(first.run.id)).cases).toEqual([]);
    const resumed = await runEval({ dataset, spec, experiments: processor, store, resume: first.run.id, concurrency: 4 });
    expect(calls).toBe(4 + 8);
    expect(resumed.cases.map(row => `${row.caseId}:${row.outcome}`)).toEqual(cases.map(item => `${item.id}:scored`));
  });

  it("retries errored rows instead of reusing them", async () => {
    const store = memoryRunStore(); const controller = new AbortController(); const calls: string[] = [];
    const flaky: EvalExtractor = { id: "p", async extract(item) {
      calls.push(item.id);
      if (calls.length === 2) throw new Error("rate limited");
      if (calls.length === 3) controller.abort();
      return { raw: item.expected };
    } };
    const first = await runEval({ dataset, spec, experiments: flaky, store, signal: controller.signal });
    expect(first.cases.map(row => `${row.caseId}:${row.outcome}`)).toEqual(["c0:scored", "c1:errored", "c2:scored"]);
    const resumed = await runEval({ dataset, spec, experiments: flaky, store, resume: first.run.id });
    expect(calls).toEqual(["c0", "c1", "c2", "c1", "c3", "c4", "c5", "c6", "c7"]);
    expect(resumed.cases.every(row => row.outcome === "scored")).toBe(true);
  });

  it("re-scores reused rows from stored raw output with the current spec", async () => {
    const schema = { type: "object", properties: { value: { type: "number" } } };
    const strict = defineEval(schema); const lenient = defineEval(schema, { fields: { value: number({ abs: 1 }) } });
    const store = memoryRunStore(); const controller = new AbortController(); let calls = 0;
    const processor: EvalExtractor = { id: "p", async extract(item) {
      calls++;
      if (calls === 4) controller.abort();
      return { raw: { value: (item.expected as { value: number }).value + 0.5 }, confidence: { value: 0.9 } };
    } };
    const first = await runEval({ dataset, spec: strict, experiments: processor, store, signal: controller.signal });
    expect(first.cases.map(row => row.values?.["f1"])).toEqual([0, 0, 0, 0]);
    const resumed = await runEval({ dataset, spec: lenient, experiments: processor, store, resume: first.run.id });
    expect(calls).toBe(8);
    expect(resumed.cases.map(row => row.values?.["f1"])).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(resumed.cases[0]).toMatchObject({ outcome: "scored", score: { fields: [{ path: "value", confidence: 0.9 }] } });
  });

  it("never reuses rows or raw output from another experiment config, even after a crash", async () => {
    const real = memoryRunStore(); let calls = 0;
    const versioned = (version: number): EvalExtractor => ({ id: "p", config: { version }, async extract() { calls++; return { raw: { value: version * 100 } }; } });
    const two = inMemoryDataset("x", cases.slice(0, 2));
    await expect(runEval({ dataset: two, spec, experiments: versioned(1), store: crashingOnFinalize(real) })).rejects.toThrow("crash");
    const id = (await real.listRuns())[0]?.id ?? "";
    await expect(runEval({ dataset: two, spec, experiments: versioned(2), store: crashingOnFinalize(real), resume: id })).rejects.toThrow("crash");
    expect(calls).toBe(4);
    const resumed = await runEval({ dataset: two, spec, experiments: versioned(1), store: real, resume: id });
    expect(calls).toBe(6);
    expect(resumed.cases.map(row => row.outcome === "scored" ? row.actual : null)).toEqual([{ value: 100 }, { value: 100 }]);
    expect(resumed.cases.map(row => row.configHash)).toEqual([resumed.run.experiments[0]?.configHash, resumed.run.experiments[0]?.configHash]);
  });

  it("re-extracts when a crash left raw output from another config behind the latest row", async () => {
    const real = memoryRunStore(); let calls = 0;
    const versioned = (version: number): EvalExtractor => ({ id: "p", config: { version }, async extract() { calls++; return { raw: { value: version * 100 } }; } });
    const one = inMemoryDataset("x", cases.slice(0, 1));
    await expect(runEval({ dataset: one, spec, experiments: versioned(1), store: crashingOnFinalize(real) })).rejects.toThrow("crash");
    const id = (await real.listRuns())[0]?.id ?? "";
    const crashAfterRaw = { ...real, async appendCase() { throw new Error("crash"); } };
    await expect(runEval({ dataset: one, spec, experiments: versioned(2), store: crashAfterRaw, resume: id })).rejects.toThrow("crash");
    const resumed = await runEval({ dataset: one, spec, experiments: versioned(1), store: real, resume: id });
    expect(calls).toBe(3);
    expect(resumed.cases.map(row => row.outcome === "scored" ? row.actual : null)).toEqual([{ value: 100 }]);
  });

  it("refreshes slices on reused rows from the current options", async () => {
    const store = memoryRunStore(); const controller = new AbortController(); let calls = 0;
    const processor: EvalExtractor = { id: "p", async extract(item) { calls++; if (calls === 2) controller.abort(); return { raw: item.expected }; } };
    const tagged = inMemoryDataset("x", cases.slice(0, 3).map(item => ({ ...item, tags: { layout: "a" } })));
    const first = await runEval({ dataset: tagged, spec, experiments: processor, store, signal: controller.signal, slices: { old: "tags.layout" } });
    expect(first.cases.map(row => row.slices)).toEqual([{ old: "a" }, { old: "a" }]);
    const resumed = await runEval({ dataset: tagged, spec, experiments: processor, store, resume: first.run.id, slices: { layout: "tags.layout" } });
    expect(calls).toBe(3);
    expect(resumed.cases.map(row => row.slices)).toEqual([{ layout: "a" }, { layout: "a" }, { layout: "a" }]);
  });

  it("resumes the latest unfinished run of the same dataset and experiments", async () => {
    const store = memoryRunStore(); let calls = 0;
    const abortAfter = (count: number): { processor: EvalExtractor; signal: AbortSignal } => {
      const controller = new AbortController();
      return { signal: controller.signal, processor: { id: "p", async extract(item) { calls++; if (calls >= count) controller.abort(); return { raw: item.expected }; } } };
    };
    const target = abortAfter(1);
    const unfinished = await runEval({ dataset, spec, experiments: target.processor, store, signal: target.signal });
    const other = abortAfter(2);
    await runEval({ dataset: inMemoryDataset("other", cases), spec, experiments: other.processor, store, signal: other.signal });
    await runEval({ dataset, spec, experiments: { q: { id: "q", async extract(item) { return { raw: item.expected }; } } }, store });
    await runEval({ dataset, spec, experiments: { id: "p", async extract(item) { return { raw: item.expected }; } }, store });
    calls = 0;
    const resumed = await runEval({ dataset, spec, experiments: { id: "p", async extract(item) { calls++; return { raw: item.expected }; } }, store, resume: "latest" });
    expect(resumed.run.id).toBe(unfinished.run.id);
    expect(calls).toBe(7);
  });

  it("refuses to resume a complete run", async () => {
    const store = memoryRunStore();
    const processor: EvalExtractor = { id: "p", async extract(item) { return { raw: item.expected }; } };
    const complete = await runEval({ dataset, spec, experiments: processor, store });
    const error = await runEval({ dataset, spec, experiments: processor, store, resume: complete.run.id }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunStoreError);
    expect(error).toMatchObject({ reason: "conflict" });
    expect((await store.readResult(complete.run.id)).run.finishedAt).toBe(complete.run.finishedAt);
    const latest = await runEval({ dataset, spec, experiments: processor, store, resume: "latest" }).catch((e: unknown) => e);
    expect(latest).toBeInstanceOf(RunStoreError);
    expect(latest).toMatchObject({ reason: "not-found" });
  });
});
