import { describe, expect, it } from "vitest";
import * as evaluation from "../../src/eval/index.js";

describe("eval gates", () => {
  it("reports exact independent threshold reasons and passes equality", () => {
    const gate: unknown = Reflect.get(evaluation, "gate");
    expect(typeof gate).toBe("function");
    if (typeof gate !== "function") return;
    const summary = evaluation.aggregate([]);
    const measured = { ...summary, meanF1: 0.5, totalCostUsd: 0.02 };
    const f1 = "Mean F1 0.500 is below the --min-f1 gate of 0.9.";
    const cost = "Total cost $0.0200 exceeds the --max-cost-usd gate of $0.0100.";
    expect(gate(measured, {})).toEqual({ pass: true, reasons: [] });
    expect(gate(measured, { minF1: 0.5, maxCostUsd: 0.02 })).toEqual({ pass: true, reasons: [] });
    expect(gate(measured, { minF1: 0.9 })).toEqual({ pass: false, reasons: [f1] });
    expect(gate(measured, { maxCostUsd: 0.01 })).toEqual({ pass: false, reasons: [cost] });
    expect(gate(measured, { minF1: 0.9, maxCostUsd: 0.01 })).toEqual({ pass: false, reasons: [f1, cost] });
  });

  it("rejects invalid public threshold domains", () => {
    const gate: unknown = Reflect.get(evaluation, "gate");
    expect(typeof gate).toBe("function");
    if (typeof gate !== "function") return;
    for (const options of [{ minF1: -1 }, { minF1: 2 }, { minF1: NaN }, { maxCostUsd: -1 }, { maxCostUsd: Infinity }]) {
      expect(() => gate(evaluation.aggregate([]), options)).toThrow(RangeError);
    }
  });
});
