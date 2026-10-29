import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { looseEval, inMemoryDataset, OutOfScopeError, type EvalExtractor } from "../src/index.js";
import { extractionMatchers, describeEval, type ExtractionMatchers, type DescribeEvalHost } from "../src/adapters/vitest/index.js";
import { extractionScorer } from "../src/adapters/evalite/index.js";
import { extractionAssertion } from "../src/adapters/promptfoo/index.js";
import { ExtractionF1 } from "../src/adapters/autoevals/index.js";

declare module "vitest" {
  interface Matchers<T = any> extends ExtractionMatchers {}
}

expect.extend(extractionMatchers());

const spec = looseEval();
const ungraded = { scoreAsync: async () => ({ ...spec.score({ n: 1 }, { n: 1 }), metrics: { ...spec.score({ n: 1 }, { n: 1 }).metrics, f1: null } }) };

describe("Vitest matcher through expect", () => {
  it("passes a matching extraction", async () => {
    await expect({ amount: 1, currency: "EUR" }).toMatchExtraction({ amount: 1, currency: "EUR" }, spec);
  });

  it("fails a mismatch with the F1 and every differing path", async () => {
    await expect(expect({ amount: 2, currency: "EUR" }).toMatchExtraction({ amount: 1, currency: "EUR" }, spec)).rejects.toThrow(
      "Expected extraction F1 >= 1; received 0.5\namount: mismatch; expected 1, received 2",
    );
  });

  it("accepts a partial match at or above minF1", async () => {
    await expect({ amount: 2, currency: "EUR" }).toMatchExtraction({ amount: 1, currency: "EUR" }, spec, { minF1: 0.5 });
  });

  it("inverts with .not and explains why the extraction should not have matched", async () => {
    await expect({ amount: 2 }).not.toMatchExtraction({ amount: 1 }, spec);
    await expect(expect({ amount: 1 }).not.toMatchExtraction({ amount: 1 }, spec)).rejects.toThrow("Expected extraction F1 < 1; received 1");
  });

  it("fails closed when nothing is gradable", async () => {
    await expect(expect({}).toMatchExtraction({}, ungraded)).rejects.toThrow("Expected extraction F1 >= 1; received ungraded");
  });
});

interface FakeHost extends DescribeEvalHost {
  readonly run: () => Promise<{ readonly name: string; readonly status: "passed" | "failed" | "skipped"; readonly message?: string }[]>;
}

function fakeHost(): FakeHost {
  const tests: { name: string; fn: (context: { skip(note?: string): never }) => Promise<void> }[] = [];
  const before: (() => unknown)[] = [];
  const after: (() => unknown)[] = [];
  class Skipped extends Error {}
  return {
    test: (name, fn) => { tests.push({ name, fn }); },
    beforeAll: (fn) => { before.push(fn); },
    afterAll: (fn) => { after.push(fn); },
    async run() {
      for (const hook of before) await hook();
      const outcomes = [];
      for (const { name, fn } of tests) {
        try {
          await fn({ skip: (note) => { throw new Skipped(note); } });
          outcomes.push({ name, status: "passed" as const });
        } catch (error) {
          if (error instanceof Skipped) outcomes.push({ name, status: "skipped" as const, message: error.message });
          else outcomes.push({ name, status: "failed" as const, message: (error as Error).message });
        }
      }
      for (const hook of after) await hook();
      return outcomes;
    },
  };
}

describe("describeEval", () => {
  const dataset = inMemoryDataset("three", [
    { id: "one", documents: [], expected: { n: 1 } },
    { id: "two", documents: [], expected: { n: 2 } },
    { id: "three", documents: [], expected: { n: 3 } },
  ]);

  it("prepares and disposes the processor once around every case", async () => {
    const calls: string[] = [];
    let disposed = false;
    const processor: EvalExtractor<{ nested: unknown }, unknown> = {
      id: "echo",
      async preflight() { calls.push("preflight"); },
      async extract(item) {
        if (disposed) throw new Error("extract after dispose");
        calls.push(`extract ${item.id}`);
        return { raw: { nested: item.expected } };
      },
      project: (raw) => raw.nested,
      dispose() { calls.push("dispose"); disposed = true; },
    };
    const host = fakeHost();
    await describeEval(dataset, spec, processor, host);
    expect(await host.run()).toEqual([
      { name: "one", status: "passed" }, { name: "two", status: "passed" }, { name: "three", status: "passed" },
    ]);
    expect(calls).toEqual(["preflight", "extract one", "extract two", "extract three", "dispose"]);
  });

  it("fails a mismatching case with its diff and skips an out-of-scope case", async () => {
    const processor: EvalExtractor = {
      id: "flaky",
      async extract(item) {
        if (item.id === "two") return { raw: { n: 20 } };
        if (item.id === "three") throw new OutOfScopeError("handwritten");
        return { raw: item.expected };
      },
    };
    const host = fakeHost();
    await describeEval(dataset, spec, processor, host);
    expect(await host.run()).toEqual([
      { name: "one", status: "passed" },
      { name: "two", status: "failed", message: "Expected extraction F1 >= 1; received 0\nn: mismatch; expected 2, received 20" },
      { name: "three", status: "skipped", message: "handwritten" },
    ]);
  });
});

describe("framework scorers", () => {
  const expected = { a: 1, b: 2 };
  const cases = [
    { output: { a: 1, b: 2 }, precision: 1, recall: 1, f1: 1 },
    { output: { a: 1, b: 2, c: 3 }, precision: 2 / 3, recall: 1, f1: 0.8 },
    { output: { a: 1 }, precision: 1, recall: 0.5, f1: 2 / 3 },
    { output: { a: 9, b: 9 }, precision: 0, recall: 0, f1: 0 },
  ];

  it.each(cases)("Evalite scorer reports the selected metric of $output", async ({ output, precision, recall, f1 }) => {
    expect(extractionScorer(spec).name).toBe("Extraction f1");
    expect(await extractionScorer(spec).scorer({ output, expected })).toBeCloseTo(f1, 10);
    expect(await extractionScorer(spec, { metric: "precision" }).scorer({ output, expected })).toBeCloseTo(precision, 10);
    expect(await extractionScorer(spec, { metric: "recall" }).scorer({ output, expected })).toBeCloseTo(recall, 10);
  });

  it("Evalite scorer scores an ungraded value zero", async () => {
    expect(await extractionScorer(ungraded).scorer({ output: {}, expected: {} })).toBe(0);
  });

  it("autoevals score carries the F1 and literal counts", async () => {
    expect(await ExtractionF1(spec)({ output: { a: 1, c: 3 }, expected })).toEqual({
      name: "ExtractionF1", score: 0.5, metadata: { counts: { match: 1, mismatch: 0, omission: 1, hallucination: 1 }, ungraded: false },
    });
    expect(await ExtractionF1(spec)({ output: expected, expected })).toEqual({
      name: "ExtractionF1", score: 1, metadata: { counts: { match: 2, mismatch: 0, omission: 0, hallucination: 0 }, ungraded: false },
    });
    expect(await ExtractionF1(ungraded)({ output: {}, expected: {} })).toMatchObject({ score: 0, metadata: { ungraded: true } });
  });

  it("promptfoo assertion parses JSON output and grades it against the threshold", async () => {
    expect(await extractionAssertion(spec)('{"a":1,"b":2}', { vars: { expected } })).toEqual({ pass: true, score: 1, reason: "Extraction F1 1; required 0.95" });
    expect(await extractionAssertion(spec, { threshold: 0.8 })({ a: 1, b: 2, c: 3 }, { vars: { expected } })).toEqual({ pass: true, score: 0.8, reason: "Extraction F1 0.8; required 0.8" });
    expect(await extractionAssertion(spec, { threshold: 0.9 })({ a: 1 }, { vars: { expected } })).toMatchObject({ pass: false, score: 2 / 3 });
    expect((await extractionAssertion(ungraded)({}, { vars: { expected: {} } })).pass).toBe(false);
  });

  it("promptfoo assertion fails output that is not JSON instead of throwing", async () => {
    expect(await extractionAssertion(spec)("Sorry, I cannot read this invoice.", { vars: { expected } })).toEqual({
      pass: false, score: 0, reason: expect.stringMatching(/^Output is not JSON: /),
    });
  });
});

await describeEval(
  inMemoryDataset("registered", [{ id: "registered with Vitest", documents: [], expected: { n: 1 } }, { id: "skipped by Vitest", documents: [], expected: { n: 2 } }]),
  spec,
  { id: "echo", async extract(item) { if (item.id === "skipped by Vitest") throw new OutOfScopeError("out of scope"); return { raw: item.expected }; } },
  { test: it, beforeAll, afterAll },
);
