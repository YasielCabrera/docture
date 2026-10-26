import { describe, expect, it } from "vitest";
import { EMPTY_USAGE } from "../../src/core/index.js";
import { aggregate, recordRun, scoreExtraction } from "../../src/eval/index.js";

const result = { method: "fixed", loader: "fake", usage: EMPTY_USAGE, attempts: [] };

describe("field aggregates", () => {
  it("folds indexed paths and computes literal per-field counts and metrics", () => {
    const first = recordRun("first", scoreExtraction(
      { lineItems: [{ amount: 10 }], needed: "x" },
      { lineItems: [{ amount: 10 }], extra: "invented" },
    ), result);
    const second = recordRun("second", scoreExtraction(
      { lineItems: [null, null, null, null, null, null, null, { amount: 20 }], needed: "x" },
      { lineItems: [null, null, null, null, null, null, null, { amount: 30 }], needed: "x" },
    ), result);
    const summary = aggregate([first, second]);
    const expected = {
      "lineItems[].amount": { match: 1, mismatch: 1, omission: 0, hallucination: 0, precision: 0.5, recall: 0.5, f1: 0.5 },
      needed: { match: 1, mismatch: 0, omission: 1, hallucination: 0, precision: 1, recall: 0.5, f1: 0.6666666666666666 },
      extra: { match: 0, mismatch: 0, omission: 0, hallucination: 1, precision: 0, recall: 1, f1: 0 },
    };
    expect(Reflect.get(summary, "byField")).toEqual(expected);
    expect(JSON.parse(JSON.stringify(summary)).byField).toEqual(expected);
  });

  it("returns an empty field map for no documents", () => {
    expect(Reflect.get(aggregate([]), "byField")).toEqual({});
  });

  it("retains arbitrary field names without prototype collisions", () => {
    const data: unknown = JSON.parse('{"__proto__":"literal"}');
    const summary = aggregate([recordRun("hostile", scoreExtraction(data, data), result)]);
    expect(JSON.parse(JSON.stringify(summary)).byField).toEqual(JSON.parse(
      '{"__proto__":{"match":1,"mismatch":0,"omission":0,"hallucination":0,"precision":1,"recall":1,"f1":1}}',
    ));
  });
});
