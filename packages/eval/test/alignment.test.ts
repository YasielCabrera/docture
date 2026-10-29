import { describe, expect, it } from "vitest";
import { z } from "zod";
import { solveAssignment } from "../src/align/assignment.js";
import { buildResult, byIndex, defineEval, hungarian, number, ordered, text, toJsonValue, type ArrayRule } from "../src/index.js";
import { runInfo } from "./support/run.js";

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function bruteForce(cost: Float64Array, rows: number, cols: number): number {
  const [small, large, at] = rows <= cols
    ? [rows, cols, (i: number, j: number) => cost[i * cols + j]!]
    : [cols, rows, (i: number, j: number) => cost[j * cols + i]!];
  let best = Infinity;
  const used = new Array<boolean>(large).fill(false);
  const visit = (i: number, total: number): void => {
    if (i === small) {
      best = Math.min(best, total);
      return;
    }
    for (let j = 0; j < large; j += 1) {
      if (used[j]) continue;
      used[j] = true;
      visit(i + 1, total + at(i, j));
      used[j] = false;
    }
  };
  visit(0, 0);
  return best;
}

const Lines = z.object({ lines: z.array(z.object({ sku: z.string(), description: z.string(), amount: z.number() })) });

function linesSpec(rule: ArrayRule) {
  return defineEval(Lines, {
    fields: { "lines[].sku": text({ minSimilarity: 1 }), "lines[].description": text({ minSimilarity: 0.8 }), "lines[].amount": number({ abs: 0.01 }) },
    arrays: { lines: rule },
  });
}

const line = (sku: string, description: string, amount: number) => ({ sku, description, amount });

describe("optimal assignment", () => {
  it("finds the minimum total cost that brute force finds on random matrices", () => {
    const next = random(7);
    for (let trial = 0; trial < 300; trial += 1) {
      const rows = 1 + Math.floor(next() * 6);
      const cols = 1 + Math.floor(next() * 6);
      const cost = Float64Array.from({ length: rows * cols }, () => Math.round(next() * 20) / 4);
      const assignment = solveAssignment(cost, rows, cols);
      const total = [...assignment].reduce((sum, col, row) => sum + (col >= 0 ? cost[row * cols + col]! : 0), 0);
      expect([...assignment].filter((col) => col >= 0)).toHaveLength(Math.min(rows, cols));
      expect(new Set([...assignment].filter((col) => col >= 0)).size).toBe(Math.min(rows, cols));
      expect(total).toBeCloseTo(bruteForce(cost, rows, cols), 9);
    }
  });
});

describe("array alignment", () => {
  it("reports a truncated list as missing rows whose every leaf is an omission", () => {
    const expected = { lines: [line("A", "bolts", 1), line("B", "nuts", 2), line("C", "washers", 3), line("D", "rivets", 4), line("E", "pins", 5)] };
    const actual = { lines: expected.lines.slice(0, 3) };
    const score = linesSpec(hungarian({ key: ["sku"] })).score(expected, actual);
    expect(score.arrays).toEqual([{
      path: "lines", pattern: "lines", algorithm: "exact-key", expected: 5, actual: 3, matched: 3, missing: 2, extra: 0, outOfOrder: 0, splits: [], merges: [],
    }]);
    expect(score.fields.filter((field) => field.status !== "match").map((field) => [field.path, field.status])).toEqual([
      ["lines[3].sku", "omission"], ["lines[3].description", "omission"], ["lines[3].amount", "omission"],
      ["lines[4].sku", "omission"], ["lines[4].description", "omission"], ["lines[4].amount", "omission"],
    ]);
    expect([score.metrics.precision, score.metrics.recall]).toEqual([1, 0.6]);
  });

  it("pairs reordered rows by content and counts how many are out of order", () => {
    const expected = { lines: [line("A", "bolts", 1), line("B", "nuts", 2), line("C", "washers", 3), line("D", "rivets", 4)] };
    const actual = { lines: [expected.lines[1]!, expected.lines[0]!, expected.lines[2]!, expected.lines[3]!] };
    const score = linesSpec(hungarian()).score(expected, actual);
    expect([score.arrays[0]?.algorithm, score.arrays[0]?.matched, score.arrays[0]?.outOfOrder, score.metrics.exact]).toEqual(["hungarian", 4, 1, true]);
    expect(score.fields.filter((field) => field.pattern === "lines[].sku").map((field) => [field.path, field.actualPath ?? field.path])).toEqual([
      ["lines[0].sku", "lines[1].sku"], ["lines[1].sku", "lines[0].sku"], ["lines[2].sku", "lines[2].sku"], ["lines[3].sku", "lines[3].sku"],
    ]);
  });

  it("keeps order with ordered alignment and numbers an inserted row after the expected rows", () => {
    const expected = { lines: [line("A", "bolts", 1), line("B", "nuts", 2), line("C", "washers", 3)] };
    const actual = { lines: [expected.lines[0]!, line("Z", "freight surcharge", 99), expected.lines[1]!, expected.lines[2]!] };
    const score = linesSpec(ordered({ minSimilarity: 0.6 })).score(expected, actual);
    expect([score.arrays[0]?.matched, score.arrays[0]?.extra]).toEqual([3, 1]);
    expect(score.fields.filter((field) => field.status === "hallucination").map((field) => [field.path, field.actualPath])).toEqual([
      ["lines[3].sku", "lines[1].sku"], ["lines[3].description", "lines[1].description"], ["lines[3].amount", "lines[1].amount"],
    ]);
  });

  it("pairs rows by position with byIndex regardless of content", () => {
    const spec = defineEval(Lines, { fields: { "lines[].sku": text({ minSimilarity: 1 }), "lines[].description": text({ minSimilarity: 1 }) }, arrays: { lines: byIndex() } });
    const score = spec.score({ lines: [line("A", "bolts", 1), line("B", "nuts", 2)] }, { lines: [line("B", "nuts", 2), line("A", "bolts", 1)] });
    expect([score.arrays[0]?.algorithm, score.counts]).toEqual(["index", { match: 0, mismatch: 6, omission: 0, hallucination: 0 }]);
  });

  it("flags a row split in two and two rows merged into one", () => {
    const spec = linesSpec(hungarian({ minSimilarity: 0.7 }));
    const split = spec.score(
      { lines: [line("A", "bolts", 5), line("B", "steel hex bolts zinc plated", 30)] },
      { lines: [line("A", "bolts", 5), line("B", "steel hex bolts", 10), line("B", "zinc plated", 20)] },
    );
    expect([split.arrays[0]?.splits, split.arrays[0]?.merges]).toEqual([[{ expected: 1, actual: [1, 2] }], []]);
    const merged = spec.score(
      { lines: [line("B", "steel hex bolts", 10), line("B", "zinc plated", 20)] },
      { lines: [line("B", "steel hex bolts zinc plated", 30)] },
    );
    expect([merged.arrays[0]?.splits, merged.arrays[0]?.merges]).toEqual([[], [{ expected: [0, 1], actual: 0 }]]);
  });

  it("keeps order when ordered alignment exceeds its cell budget and warns about the fallback", () => {
    const expected = { lines: [line("A", "bolts", 1), line("B", "nuts", 2), line("C", "washers", 3), line("D", "rivets", 4)] };
    const actual = { lines: [expected.lines[1]!, expected.lines[0]!, expected.lines[2]!, expected.lines[3]!] };
    const spec = linesSpec(ordered({ maxCells: 4 }));
    const score = spec.score(expected, actual);
    const report = score.arrays[0];
    expect([report?.algorithm, report?.matched, report?.missing, report?.extra, report?.outOfOrder]).toEqual(["ordered-greedy", 3, 1, 1, 0]);
    const row = { caseId: "c1", experiment: "x", epoch: 0, tags: {}, startedAt: "2026-10-28T12:00:00.000Z", ms: 1 };
    const result = buildResult({ run: runInfo(["x"], 1, spec), cases: [{ ...row, outcome: "scored", expected: toJsonValue(expected), actual: toJsonValue(actual), score }] });
    expect(result.warnings).toEqual([
      "Alignment of lines fell back to order-preserving greedy pairing in 1 case because the cost matrix exceeded its cell budget. Add a key or raise maxCells to align exactly.",
    ]);
  });

  it("holds rows that share a key to the cell budget", () => {
    const expected = { lines: [line("A", "bolts", 1), line("A", "nuts", 2), line("A", "washers", 3)] };
    const actual = { lines: [expected.lines[2]!, expected.lines[0]!, expected.lines[1]!] };
    const within = linesSpec(hungarian({ key: ["sku"], maxCells: 9 })).score(expected, actual).arrays[0];
    const over = linesSpec(hungarian({ key: ["sku"], maxCells: 8 })).score(expected, actual).arrays[0];
    expect([within?.algorithm, within?.matched]).toEqual(["exact-key", 3]);
    expect([over?.algorithm, over?.matched]).toEqual(["greedy", 3]);
  });

  it("aligns 1,000 keyed rows exactly and falls back to greedy for 1,000 unkeyed rows within a time budget", () => {
    const next = random(11);
    const rows = Array.from({ length: 1000 }, (_unused, index) => line(`SKU-${index}`, `item ${Math.floor(next() * 1e6).toString(36)}`, index));
    const shuffled = [...rows].sort(() => next() - 0.5);
    const timed = (rule: ReturnType<typeof hungarian>) => {
      const started = performance.now();
      const score = linesSpec(rule).score({ lines: rows }, { lines: shuffled });
      return { ms: performance.now() - started, report: score.arrays[0], exact: score.metrics.exact };
    };
    const keyed = timed(hungarian({ key: ["sku"] }));
    expect([keyed.report?.algorithm, keyed.report?.matched, keyed.exact]).toEqual(["exact-key", 1000, true]);
    expect(keyed.ms).toBeLessThan(1000);
    const unkeyed = timed(hungarian());
    expect([unkeyed.report?.algorithm, unkeyed.report?.expected]).toEqual(["greedy", 1000]);
    expect(unkeyed.ms).toBeLessThan(5000);
  });
});
