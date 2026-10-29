import { describe, expect, it } from "vitest";
import { defineEval, defineMetric, inMemoryDataset, number, type EvalExtractor } from "../src/index.js";
import { memoryRunStore, rescore, runEval } from "../src/runner/index.js";

const narrow = defineEval({ type: "object", properties: { value: { type: "number" } } });
const wide = defineEval({ type: "object", properties: { value: { type: "number" }, extra: { type: "number" } } }, { fields: { value: number({ abs: 1 }) } });
const dataset = inMemoryDataset("x", [{ id: "a", documents: [], expected: { value: 10 }, tags: { layout: "scan" } }]);
const widened = inMemoryDataset("x", [{ id: "a", documents: [], expected: { value: 10, extra: 2 }, tags: { layout: "scan" } }]);
const processor: EvalExtractor = { id: "p", async extract() { return { raw: { value: 10.5, extra: 2 }, confidence: { value: 0.9, extra: 0.7 }, evidence: [{ path: "extra", pageNumber: 2 }] }; } };

describe("rescore", () => {
  it("writes a new run linked to its source and leaves the source untouched", async () => {
    const store = memoryRunStore();
    const source = await runEval({ dataset, spec: narrow, store, experiments: processor });
    const rescored = await rescore(store, source.run.id, wide);
    expect(rescored.run.id).not.toBe(source.run.id);
    expect(rescored.run.rescoredFrom).toBe(source.run.id);
    expect(rescored.extensions).toEqual({});
    expect(await store.readResult(source.run.id)).toEqual(source);
    expect(await store.readResult(rescored.run.id)).toEqual(rescored);
    expect((await store.listRuns()).map(entry => entry.id)).toEqual([source.run.id, rescored.run.id]);
    const again = await rescore(store, rescored.run.id, narrow);
    expect(again.run.rescoredFrom).toBe(rescored.run.id);
    expect(again.summary["p"]?.overall["f1"]).toBe(source.summary["p"]?.overall["f1"]);
  });

  it("keeps confidence and evidence for paths the source spec did not score", async () => {
    const store = memoryRunStore();
    const source = await runEval({ dataset, spec: narrow, store, experiments: processor });
    const rescored = await rescore(store, source.run.id, wide, { dataset: widened });
    const row = rescored.cases[0];
    expect(row?.outcome === "scored" ? row.score.fields.map(field => [field.path, field.confidence, field.evidence?.map(item => item.pageNumber)]) : []).toEqual([["value", 0.9, undefined], ["extra", 0.7, [2]]]);
  });

  it("applies metrics, slices, sections, gate and enrich to the new run", async () => {
    const store = memoryRunStore();
    const source = await runEval({ dataset, spec: narrow, store, experiments: processor });
    const layouts: string[] = [];
    const rescored = await rescore(store, source.run.id, wide, {
      dataset: widened,
      metrics: [defineMetric({ id: "always", label: "Always", direction: "higher", format: "ratio", perCase: () => 1, aggregate: () => 1 })],
      slices: { layout: "tags.layout" },
      sections: [result => { layouts.push(...result.cases.map(row => String(row.slices?.["layout"]))); return {}; }],
      gate: { thresholds: [{ metric: "f1", min: 1 }] },
      enrich: () => ({ note: "rescored" }),
    });
    expect(rescored.summary["p"]?.overall["always"]).toBe(1);
    expect(layouts).toEqual(["scan"]);
    expect(rescored.gate?.pass).toBe(true);
    expect(rescored.extensions).toEqual({ note: "rescored" });
  });
});
