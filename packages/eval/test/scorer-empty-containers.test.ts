import { describe, expect, it } from "vitest";
import { scoreExtraction } from "../src/index.js";

describe("empty containers", () => {
  it.each([
    { name: "nested objects", expected: { a: {} }, actual: { a: {} } },
    { name: "nested arrays", expected: { a: [] }, actual: { a: [] } },
    { name: "root objects", expected: {}, actual: {} },
    { name: "root arrays", expected: [], actual: [] },
    { name: "objects with null prototypes", expected: { a: Object.create(null) }, actual: { a: {} } },
  ])("matches empty $name", ({ expected, actual }) => {
    const score = scoreExtraction(expected, actual);

    expect(score.f1).toBe(1);
    expect(score.exactMatch).toBe(true);
    expect(score.counts).toEqual({ match: 1, mismatch: 0, omission: 0, hallucination: 0 });
  });

  it("distinguishes empty arrays from empty objects", () => {
    const score = scoreExtraction({ a: [] }, { a: {} });

    expect(score.f1).toBe(0);
    expect(score.exactMatch).toBe(false);
    expect(score.fields).toEqual([{ path: "a", status: "mismatch", expected: [], actual: {} }]);
  });

  it("keeps missing and populated containers visible", () => {
    const missing = scoreExtraction({ a: [] }, { a: null });
    const populated = scoreExtraction({ a: [] }, { a: ["value"] });

    expect(missing.counts).toEqual({ match: 0, mismatch: 0, omission: 1, hallucination: 0 });
    expect(populated.counts).toEqual({ match: 0, mismatch: 0, omission: 1, hallucination: 1 });
    expect(populated.exactMatch).toBe(false);
  });

  it.each([
    { name: "without array alignment", options: {} },
    { name: "with array alignment", options: { alignArraysBy: "id" } },
  ])("does not match non-plain objects as empty plain objects $name", ({ options }) => {
    class Empty {}

    for (const actual of [new Date("2026-01-15T00:00:00Z"), new Map(), new Empty()]) {
      const score = scoreExtraction({ a: {} }, { a: actual }, options);

      expect(score.f1).toBe(0);
      expect(score.exactMatch).toBe(false);
      expect(score.counts.mismatch).toBe(1);
    }
  });

  it.each([
    { name: "dates", expected: new Date("2026-01-15T00:00:00Z"), actual: new Date("2027-06-01T00:00:00Z") },
    { name: "maps", expected: new Map([["a", 1]]), actual: new Map([["b", 2]]) },
  ])("keeps different $name distinct when aligning array rows", ({ expected, actual }) => {
    const score = scoreExtraction(
      { rows: [{ id: "a", value: expected }] },
      { rows: [{ id: "a", value: actual }] },
      { alignArraysBy: "id" },
    );

    expect(score.exactMatch).toBe(false);
    expect(score.counts).toEqual({ match: 1, mismatch: 1, omission: 0, hallucination: 0 });
  });
});
