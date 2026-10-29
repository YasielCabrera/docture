import { solveAssignment } from "./assignment.js";
import type { ArrayRule } from "./rules.js";

/**
 * The algorithm that produced an alignment. `greedy` and `ordered-greedy` mean the cost matrix exceeded its
 * budget: `greedy` replaces `hungarian` and `exact-key`, and `ordered-greedy` replaces `ordered` without crossing pairs.
 */
export type AlignmentAlgorithm = "index" | "ordered" | "exact-key" | "hungarian" | "greedy" | "ordered-greedy";

/** True for the algorithms that replace an exact one above the cell budget. */
export function isFallback(algorithm: AlignmentAlgorithm): boolean {
  return algorithm === "greedy" || algorithm === "ordered-greedy";
}

/** How the rows of one array were paired, and what went unpaired. */
export interface AlignmentReport {
  /** Concrete path of the array, such as `lineItems` or `invoices[0].lineItems`. */
  readonly path: string;
  readonly pattern: string;
  readonly algorithm: AlignmentAlgorithm;
  readonly expected: number;
  readonly actual: number;
  readonly matched: number;
  /** Expected rows with no partner. A truncated list shows up here. */
  readonly missing: number;
  /** Actual rows with no partner. */
  readonly extra: number;
  /** Matched rows that would have to move to restore the expected order. */
  readonly outOfOrder: number;
  /** Experimental: an expected row that reads as several adjacent unpaired actual rows. */
  readonly splits: readonly { readonly expected: number; readonly actual: readonly number[] }[];
  /** Experimental: several adjacent unpaired expected rows that read as one actual row. */
  readonly merges: readonly { readonly expected: readonly number[]; readonly actual: number }[];
}

/** What alignment needs to know about the rows. */
export interface RowView {
  readonly expected: number;
  readonly actual: number;
  /** Similarity in 0 to 1 of expected row `i` and actual row `j`. */
  similarity(i: number, j: number): number;
  /** Normalized key of a row, or `undefined` when a key part is absent. Only `hungarian` with `key` calls it. */
  key?(side: "expected" | "actual", index: number): string | undefined;
  /** Similarity of several expected rows read together with several actual rows, for split and merge detection. */
  combined?(expected: readonly number[], actual: readonly number[]): number;
}

/** Row pairs in expected order, plus the unpaired rows on each side. */
export interface Alignment {
  readonly algorithm: AlignmentAlgorithm;
  readonly pairs: readonly (readonly [expected: number, actual: number])[];
  readonly missing: readonly number[];
  readonly extra: readonly number[];
  readonly outOfOrder: number;
  readonly splits: AlignmentReport["splits"];
  readonly merges: AlignmentReport["merges"];
}

const GREEDY_WINDOW = 32;

function range(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => index);
}

function assign(view: RowView, rows: readonly number[], cols: readonly number[], minSimilarity: number, pairs: [number, number][]): void {
  if (rows.length === 0 || cols.length === 0) return;
  const similarity = new Float64Array(rows.length * cols.length);
  const cost = new Float64Array(rows.length * cols.length);
  rows.forEach((i, r) =>
    cols.forEach((j, c) => {
      const s = view.similarity(i, j);
      similarity[r * cols.length + c] = s;
      cost[r * cols.length + c] = s >= minSimilarity ? 1 - s : 1;
    }),
  );
  solveAssignment(cost, rows.length, cols.length).forEach((c, r) => {
    if (c >= 0 && similarity[r * cols.length + c]! >= minSimilarity) pairs.push([rows[r]!, cols[c]!]);
  });
}

function windowCandidates(
  view: RowView,
  rows: readonly number[],
  cols: readonly number[],
  minSimilarity: number,
): { r: number; c: number; s: number }[] {
  const out: { r: number; c: number; s: number }[] = [];
  rows.forEach((i, r) => {
    const center = rows.length <= 1 ? 0 : Math.round((r * (cols.length - 1)) / (rows.length - 1));
    for (let c = Math.max(0, center - GREEDY_WINDOW); c <= Math.min(cols.length - 1, center + GREEDY_WINDOW); c += 1) {
      const s = view.similarity(i, cols[c]!);
      if (s >= minSimilarity) out.push({ r, c, s });
    }
  });
  return out.sort((a, b) => b.s - a.s || a.r - b.r || a.c - b.c);
}

function greedy(view: RowView, rows: readonly number[], cols: readonly number[], minSimilarity: number, pairs: [number, number][]): void {
  const usedRows = new Set<number>();
  const usedCols = new Set<number>();
  for (const { r, c } of windowCandidates(view, rows, cols, minSimilarity)) {
    if (usedRows.has(r) || usedCols.has(c)) continue;
    usedRows.add(r);
    usedCols.add(c);
    pairs.push([rows[r]!, cols[c]!]);
  }
}

function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function orderedGreedy(view: RowView, minSimilarity: number, pairs: [number, number][]): void {
  const acceptedRows: number[] = [];
  const acceptedCols: number[] = [];
  for (const { r, c } of windowCandidates(view, range(view.expected), range(view.actual), minSimilarity)) {
    const at = lowerBound(acceptedRows, r);
    if (acceptedRows[at] === r) continue;
    if ((at > 0 && acceptedCols[at - 1]! >= c) || (at < acceptedCols.length && acceptedCols[at]! <= c)) continue;
    acceptedRows.splice(at, 0, r);
    acceptedCols.splice(at, 0, c);
  }
  acceptedRows.forEach((r, k) => pairs.push([r, acceptedCols[k]!]));
}

function longestOrderPreservingChain(view: RowView, minSimilarity: number, pairs: [number, number][]): void {
  const n = view.expected;
  const m = view.actual;
  const width = m + 1;
  const score = new Float64Array((n + 1) * width);
  const similarity = new Float64Array(n * m);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const s = view.similarity(i - 1, j - 1);
      similarity[(i - 1) * m + j - 1] = s;
      const diagonal = s >= minSimilarity ? score[(i - 1) * width + j - 1]! + s : -Infinity;
      score[i * width + j] = Math.max(score[(i - 1) * width + j]!, score[i * width + j - 1]!, diagonal);
    }
  }
  const reversed: [number, number][] = [];
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const here = score[i * width + j]!;
    if (here === score[(i - 1) * width + j]) i -= 1;
    else if (here === score[i * width + j - 1]) j -= 1;
    else {
      reversed.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    }
  }
  pairs.push(...reversed.reverse());
}

function keyed(view: RowView, minSimilarity: number, maxCells: number, pairs: [number, number][]): boolean {
  const buckets = new Map<string, { expected: number[]; actual: number[] }>();
  const rest = { expected: [] as number[], actual: [] as number[] };
  for (const side of ["expected", "actual"] as const) {
    for (const index of range(view[side])) {
      const key = view.key?.(side, index);
      if (key === undefined) rest[side].push(index);
      else {
        let bucket = buckets.get(key);
        if (bucket === undefined) buckets.set(key, (bucket = { expected: [], actual: [] }));
        bucket[side].push(index);
      }
    }
  }
  let fellBack = false;
  const pairWithin = (rows: readonly number[], cols: readonly number[]): void => {
    if (rows.length * cols.length > maxCells) {
      fellBack = true;
      greedy(view, rows, cols, minSimilarity, pairs);
    } else {
      assign(view, rows, cols, minSimilarity, pairs);
    }
  };
  for (const bucket of buckets.values()) {
    if (bucket.expected.length === 1 && bucket.actual.length === 1) {
      pairs.push([bucket.expected[0]!, bucket.actual[0]!]);
      continue;
    }
    const before = pairs.length;
    pairWithin(bucket.expected, bucket.actual);
    const paired = new Set(pairs.slice(before).flatMap(([i, j]) => [`e${i}`, `a${j}`]));
    rest.expected.push(...bucket.expected.filter((i) => !paired.has(`e${i}`)));
    rest.actual.push(...bucket.actual.filter((j) => !paired.has(`a${j}`)));
  }
  rest.expected.sort((a, b) => a - b);
  rest.actual.sort((a, b) => a - b);
  pairWithin(rest.expected, rest.actual);
  return fellBack;
}

function outOfOrder(pairs: readonly (readonly [number, number])[]): number {
  const tails: number[] = [];
  for (const [, j] of pairs) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid]! < j) low = mid + 1;
      else high = mid;
    }
    tails[low] = j;
  }
  return pairs.length - tails.length;
}

function adjacentRuns(indices: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (let k = 0; k + 1 < indices.length; k += 1) if (indices[k + 1] === indices[k]! + 1) runs.push([indices[k]!, indices[k + 1]!]);
  return runs;
}

function splitsAndMerges(
  view: RowView,
  missing: readonly number[],
  extra: readonly number[],
  minSimilarity: number,
  maxCells: number,
): Pick<Alignment, "splits" | "merges"> {
  const combined = view.combined;
  if (combined === undefined || missing.length === 0 || extra.length === 0 || missing.length * extra.length > maxCells) {
    return { splits: [], merges: [] };
  }
  const splits: { expected: number; actual: number[] }[] = [];
  const merges: { expected: number[]; actual: number }[] = [];
  const usedExpected = new Set<number>();
  const usedActual = new Set<number>();
  for (const i of missing) {
    const run = adjacentRuns(extra).find(([a, b]) => !usedActual.has(a) && !usedActual.has(b) && combined([i], [a, b]) >= minSimilarity);
    if (run === undefined) continue;
    splits.push({ expected: i, actual: run });
    usedExpected.add(i);
    run.forEach((j) => usedActual.add(j));
  }
  for (const j of extra) {
    if (usedActual.has(j)) continue;
    const run = adjacentRuns(missing).find(
      ([a, b]) => !usedExpected.has(a) && !usedExpected.has(b) && combined([a, b], [j]) >= minSimilarity,
    );
    if (run === undefined) continue;
    merges.push({ expected: run, actual: j });
    run.forEach((i) => usedExpected.add(i));
    usedActual.add(j);
  }
  return { splits, merges };
}

/** Pair the rows of one array under a rule. */
export function alignRows(rule: ArrayRule, view: RowView): Alignment {
  const pairs: [number, number][] = [];
  let algorithm: AlignmentAlgorithm;
  if (rule.kind === "index") {
    algorithm = "index";
    for (let i = 0; i < Math.min(view.expected, view.actual); i += 1) pairs.push([i, i]);
  } else if (rule.kind === "hungarian" && rule.key !== undefined) {
    algorithm = keyed(view, rule.minSimilarity, rule.maxCells, pairs) ? "greedy" : "exact-key";
  } else if (rule.kind === "ordered") {
    const fallBack = view.expected * view.actual > rule.maxCells;
    algorithm = fallBack ? "ordered-greedy" : "ordered";
    if (fallBack) orderedGreedy(view, rule.minSimilarity, pairs);
    else longestOrderPreservingChain(view, rule.minSimilarity, pairs);
  } else if (view.expected * view.actual > rule.maxCells) {
    algorithm = "greedy";
    greedy(view, range(view.expected), range(view.actual), rule.minSimilarity, pairs);
  } else {
    algorithm = "hungarian";
    assign(view, range(view.expected), range(view.actual), rule.minSimilarity, pairs);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const pairedExpected = new Set(pairs.map(([i]) => i));
  const pairedActual = new Set(pairs.map(([, j]) => j));
  const missing = range(view.expected).filter((i) => !pairedExpected.has(i));
  const extra = range(view.actual).filter((j) => !pairedActual.has(j));
  const minSimilarity = rule.kind === "index" ? 0.5 : rule.minSimilarity;
  const maxCells = rule.kind === "index" ? 0 : rule.maxCells;
  return {
    algorithm,
    pairs,
    missing,
    extra,
    outOfOrder: outOfOrder(pairs),
    ...splitsAndMerges(view, missing, extra, minSimilarity, maxCells),
  };
}
