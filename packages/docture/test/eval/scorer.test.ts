import { describe, expect, it } from "vitest";
import {
  aggregate,
  failures,
  formatFailures,
  formatScoreboard,
  hallucinations,
  recordRun,
  scoreExtraction,
} from "../../src/eval/index.js";
import { EMPTY_USAGE } from "docture";

describe("scoreExtraction", () => {
  it("scores a perfect extraction as 1 and exact", () => {
    const truth = { id: "A", total: 10, rows: [{ name: "x", amount: 1 }] };
    const score = scoreExtraction(truth, structuredClone(truth));

    expect(score.f1).toBe(1);
    expect(score.exactMatch).toBe(true);
    expect(score.counts.match).toBeGreaterThan(0);
    expect(failures(score)).toEqual([]);
  });

  it("distinguishes a wrong value from a missing one from an invented one", () => {
    const score = scoreExtraction(
      { wrong: "expected", missing: "gone", right: "same" },
      { wrong: "actual", right: "same", invented: "surprise" },
    );

    const byPath = new Map(score.fields.map((f) => [f.path, f.status]));
    expect(byPath.get("wrong")).toBe("mismatch");
    expect(byPath.get("missing")).toBe("omission");
    expect(byPath.get("right")).toBe("match");
    expect(byPath.get("invented")).toBe("hallucination");

    expect(hallucinations(score).map((f) => f.path)).toEqual(["invented"]);
  });

  it("forgives float dust in money", () => {
    expect(scoreExtraction({ total: 1234.56 }, { total: 1234.5599999 }).f1).toBe(1);
    // But not a real difference.
    expect(scoreExtraction({ total: 1234.56 }, { total: 1234.78 }).f1).toBe(0);
  });

  it("compares dates as days, not as strings", () => {
    expect(scoreExtraction({ issuedAt: "2026-01-15" }, { issuedAt: "2026-01-15T00:00:00Z" }).f1).toBe(1);
    expect(scoreExtraction({ issuedAt: "2026-01-15" }, { issuedAt: "2026-01-16" }).f1).toBe(0);
  });

  it("forgives an OCR slip in a long string but not a different value", () => {
    // One character wrong in 25 clears the 0.9 similarity floor.
    expect(
      scoreExtraction(
        { name: "Northwind Industrial GmbH" },
        { name: "Northwind lndustrial GmbH" },
      ).f1,
    ).toBe(1);
    expect(scoreExtraction({ name: "Acme Ltd" }, { name: "Globex Inc" }).f1).toBe(0);
  });

  it("treats case and whitespace as noise", () => {
    expect(scoreExtraction({ n: "Acme  Ltd" }, { n: "acme ltd" }).f1).toBe(1);
  });

  it("respects a tightened tolerance", () => {
    const options = { numericTolerance: 0, stringSimilarity: 1 };
    expect(scoreExtraction({ total: 1 }, { total: 1.001 }, options).f1).toBe(0);
    expect(scoreExtraction({ n: "Acme" }, { n: "Acne" }, options).f1).toBe(0);
  });

  it("scores array elements by index, so row order matters", () => {
    const expected = { rows: [{ n: "a" }, { n: "b" }] };
    const swapped = { rows: [{ n: "b" }, { n: "a" }] };
    expect(scoreExtraction(expected, swapped).f1).toBe(0);
  });

  it("can align arrays by a key when order is not meaningful", () => {
    const expected = { rows: [{ id: "1", v: 10 }, { id: "2", v: 20 }] };
    const swapped = { rows: [{ id: "2", v: 20 }, { id: "1", v: 10 }] };

    expect(scoreExtraction(expected, swapped).f1).toBeLessThan(1);
    expect(scoreExtraction(expected, swapped, { alignArraysBy: "id" }).f1).toBe(1);
  });

  it("penalises a short array as omissions and a long one as hallucinations", () => {
    const short = scoreExtraction({ rows: [{ n: "a" }, { n: "b" }] }, { rows: [{ n: "a" }] });
    expect(short.counts.omission).toBe(1);
    expect(short.recall).toBeLessThan(1);
    expect(short.precision).toBe(1);

    const long = scoreExtraction({ rows: [{ n: "a" }] }, { rows: [{ n: "a" }, { n: "b" }] });
    expect(long.counts.hallucination).toBe(1);
    expect(long.precision).toBeLessThan(1);
    expect(long.recall).toBe(1);
  });

  it("treats null, undefined and empty string as absent alike", () => {
    // Both sides absent is not scored at all — it is not a win and not a loss.
    const score = scoreExtraction({ a: null, b: "" }, { a: undefined, b: null });
    expect(score.fields).toEqual([]);
    expect(score.f1).toBe(1);
  });

  it("does not credit a booleans-differ case", () => {
    expect(scoreExtraction({ ok: true }, { ok: false }).f1).toBe(0);
  });

  it("handles an empty array as a leaf, so [] vs [x] is visible", () => {
    const score = scoreExtraction({ rows: [] }, { rows: [{ n: "a" }] });
    expect(score.counts.hallucination).toBeGreaterThan(0);
  });
});

describe("reporting", () => {
  const record = (document: string, f1Source: { truth: unknown; actual: unknown }, method = "llm") =>
    recordRun(document, scoreExtraction(f1Source.truth, f1Source.actual), {
      method,
      loader: "pdfjs",
      usage: { ...EMPTY_USAGE, totalTokens: 100, costUsd: 0.01, wallMs: 50 },
      attempts: [],
    });

  it("aggregates a run set", () => {
    const records = [
      record("a", { truth: { x: 1 }, actual: { x: 1 } }),
      record("b", { truth: { x: 1 }, actual: { x: 2 } }, "parser"),
    ];

    const summary = aggregate(records);
    expect(summary.documents).toBe(2);
    expect(summary.exactMatches).toBe(1);
    expect(summary.meanF1).toBeCloseTo(0.5, 5);
    expect(summary.totalCostUsd).toBeCloseTo(0.02, 5);
    expect(summary.byMethod).toEqual({ llm: 1, parser: 1 });
  });

  it("renders a stable markdown scoreboard", () => {
    const board = formatScoreboard([
      record("z-doc", { truth: { x: 1 }, actual: { x: 1 } }),
      record("a-doc", { truth: { x: 1 }, actual: { x: 2 } }),
    ]);

    // Sorted by document, so a diff between runs is readable.
    expect(board.indexOf("a-doc")).toBeLessThan(board.indexOf("z-doc"));
    expect(board).toContain("| Document | F1 |");
    expect(board).toContain("mean F1");
  });

  it("says so when everything matched", () => {
    expect(formatFailures(scoreExtraction({ a: 1 }, { a: 1 }))).toBe("All fields matched.");
  });

  it("never lets a truncated failure list read as complete", () => {
    const truth = Object.fromEntries(Array.from({ length: 30 }, (_u, i) => [`f${i}`, i + 1]));
    const wrong = Object.fromEntries(Array.from({ length: 30 }, (_u, i) => [`f${i}`, -1]));

    const text = formatFailures(scoreExtraction(truth, wrong), 5);
    expect(text).toContain("30 field(s) did not match");
    expect(text).toContain("and 25 more");
  });
});
