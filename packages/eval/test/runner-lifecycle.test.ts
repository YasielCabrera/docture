import { DoctureError } from "docture";
import { describe, expect, it } from "vitest";
import { defineEval, GroundTruthError, inMemoryDataset, PreflightError, looseEval, parseEvalResult, type EvalExtractor, type ExtractOutput } from "../src/index.js";
import { memoryRunStore, runEval } from "../src/runner/index.js";

const spec = looseEval();
const cases = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, documents: [], expected: { value: i } }));
const copy: EvalExtractor = { id: "p", async extract(item) { return { raw: item.expected }; } };

describe("runEval lifecycle", () => {
  it("stops every lane after the first lane fails", async () => {
    const base = memoryRunStore(); let appends = 0; let calls = 0; const signals: AbortSignal[] = [];
    const store = { ...base, async appendCase(...args: Parameters<typeof base.appendCase>) { if (++appends === 1) throw new Error("disk"); return base.appendCase(...args); } };
    const processor: EvalExtractor = { id: "p", async extract(item, context) { calls++; signals.push(context.signal); await new Promise(resolve => setTimeout(resolve, 1)); return { raw: item.expected }; } };
    await expect(runEval({ dataset: inMemoryDataset("m", cases), spec, store, concurrency: 4, experiments: processor })).rejects.toThrow("disk");
    expect(calls).toBe(4);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it("fails the gate of an aborted run with a check naming the incomplete run", async () => {
    const controller = new AbortController();
    const result = await runEval({ dataset: inMemoryDataset("m", cases.slice(0, 4)), spec, signal: controller.signal, experiments: { id: "p", async extract(item) { controller.abort(); return { raw: item.expected }; } }, gate: { thresholds: [{ metric: "f1", min: 0.9 }] } });
    expect(result.run.status).toBe("aborted");
    expect(result.gate?.pass).toBe(false);
    expect(result.gate?.checks.filter(check => check.status === "fail")).toEqual([{ kind: "run", experiment: "", metric: "", target: "run status", value: null, status: "fail", message: "the run is aborted with 1 of 4 jobs recorded; a gate needs a complete run" }]);
  });

  it("persists only known output members and records invalid usage as an error", async () => {
    const outputs: Record<string, object> = {
      extra: Object.assign({ raw: { value: 1 }, diagnostics: { ratio: Number.NaN, nested: [Number.POSITIVE_INFINITY] } }, { note: "not part of the contract" }),
      usage: { raw: { value: 1 }, usage: { costUsd: Number.NaN, inputTokens: 3 } },
      method: Object.assign({ raw: { value: 1 } }, { method: 7 }),
    };
    const store = memoryRunStore();
    const result = await runEval({ dataset: inMemoryDataset("m", Object.keys(outputs).map(id => ({ id, documents: [], expected: { value: 1 } }))), spec, store, experiments: { id: "p", async extract(item) { return outputs[item.id] as ExtractOutput<unknown>; } } });
    expect(() => parseEvalResult(JSON.parse(JSON.stringify(result)))).not.toThrow();
    const [extra, usage, method] = result.cases;
    expect(extra).toMatchObject({ outcome: "scored", diagnostics: { ratio: null, nested: [null] } });
    expect(extra && "note" in extra).toBe(false);
    expect(usage).toMatchObject({ outcome: "errored", error: { name: "InvalidOutput", message: "Processor p returned invalid output for case usage: usage.costUsd must be a finite number." } });
    expect(method).toMatchObject({ outcome: "errored", error: { name: "InvalidOutput", message: "Processor p returned invalid output for case method: method must be a string." } });
  });

  it("names only the cases whose ground truth is invalid", async () => {
    const strict = defineEval({ type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false });
    const dataset = inMemoryDataset<unknown>("b", [...cases.slice(0, 3), { id: "bad", documents: [], expected: { value: "x" } }, { id: "worse", documents: [], expected: { value: true } }]);
    const error = await runEval({ dataset, spec: strict, experiments: copy }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GroundTruthError);
    expect(error).toMatchObject({
      caseIds: ["bad", "worse"],
      cases: [
        { caseId: "bad", issues: [{ code: "wrong-type", path: "value" }] },
        { caseId: "worse", issues: [{ code: "wrong-type", path: "value" }] },
      ],
    });
    expect((error as GroundTruthError).message).toMatch(/^Ground truth for 2 cases is invalid:\n  - bad\.value: /u);
  });

  it("runs preflight before creating a run and wraps its failure with the experiment id", async () => {
    const store = memoryRunStore(); const started: string[] = []; const failure = new RangeError("no key"); let disposed = 0;
    const error = await runEval({ dataset: inMemoryDataset("m", cases.slice(0, 2)), spec, store, reporters: [{ id: "r", onRunStart(run) { started.push(run.id); }, onResult() {} }], experiments: { id: "p", async preflight() { throw failure; }, async extract(item) { return { raw: item.expected }; }, dispose() { disposed++; } } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreflightError);
    expect(error).toBeInstanceOf(DoctureError);
    expect(error).toMatchObject({ code: "EVAL_PREFLIGHT_FAILED", experiment: "p", cause: failure, message: "Preflight of experiment p failed: no key" });
    expect(await store.listRuns()).toEqual([]);
    expect(started).toEqual([]);
    expect(disposed).toBe(1);
  });

  it("keeps the original failure primary when disposal also fails", async () => {
    const base = memoryRunStore(); const original = new Error("disk full"); const disposal = new Error("worker stuck");
    const store = { ...base, async appendCase() { throw original; } };
    const error = await runEval({ dataset: inMemoryDataset("m", cases.slice(0, 1)), spec, store, experiments: { ...copy, dispose() { throw disposal; } } }).catch((e: unknown) => e);
    expect(error).toBe(original);
    expect(error).toMatchObject({ disposalErrors: [disposal] });
  });

  it("reports a disposal failure after a successful run as a warning", async () => {
    const result = await runEval({ dataset: inMemoryDataset("m", cases.slice(0, 1)), spec, experiments: { ...copy, dispose() { throw new Error("worker stuck"); } } });
    expect(result.run.status).toBe("complete");
    expect(result.warnings).toEqual(["Disposing experiment p failed: worker stuck"]);
  });

  it("falls back to a configured branch for the automatic baseline", async () => {
    const store = memoryRunStore(); const dataset = inMemoryDataset("m", cases.slice(0, 2));
    const release = await runEval({ dataset, spec, store, experiments: copy, git: { branch: "release", sha: "a", dirty: false } });
    const topic = { dataset, spec, store, experiments: copy, git: { branch: "topic", sha: "b", dirty: false }, baseline: "auto" as const };
    expect((await runEval({ ...topic, git: { branch: "solo", sha: "c", dirty: false } })).comparison).toBeUndefined();
    expect((await runEval({ ...topic, fallbackBranch: "release" })).comparison?.baselineRunId).toBe(release.run.id);
  });
});
