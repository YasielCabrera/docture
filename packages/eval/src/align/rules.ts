import { unitInterval } from "../compare/options.js";
import type { JsonValue } from "../json.js";

/**
 * Cost-matrix cells (expected rows × actual rows) above which `ordered` and
 * `hungarian` fall back to greedy alignment and record a warning. Chosen from
 * the alignment benchmark in `docs/research/eval.md`.
 */
export const DEFAULT_MAX_CELLS = 250_000;

/** How the rows of an array are paired before their fields are compared. */
export type ArrayRule =
  | { readonly kind: "index" }
  | { readonly kind: "ordered"; readonly minSimilarity: number; readonly maxCells: number }
  | {
    readonly kind: "hungarian";
    readonly minSimilarity: number;
    readonly maxCells: number;
    /** Row-relative paths whose values, when all present and equal, pair rows before any similarity is computed. */
    readonly key?: readonly string[];
    /** Row-relative leaf patterns weighting row similarity. Default 1 each. */
    readonly weights?: Readonly<Record<string, number>>;
  };

function budget(owner: string, value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CELLS;
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${owner}: maxCells must be a positive integer, got ${String(value)}.`);
  return value;
}

/** Pair row i with row i. Right for tables whose order is part of the data. */
export function byIndex(): ArrayRule {
  return { kind: "index" };
}

/** Order-preserving pairing that maximizes total row similarity, like a diff. Rows below `minSimilarity` stay unpaired. */
export function ordered(options: { readonly minSimilarity?: number; readonly maxCells?: number } = {}): ArrayRule {
  return {
    kind: "ordered",
    minSimilarity: unitInterval("ordered", "minSimilarity", options.minSimilarity) ?? 0.5,
    maxCells: budget("ordered", options.maxCells),
  };
}

/**
 * Order-free pairing: rows with equal `key` values pair first, the rest by an
 * optimal assignment on row similarity. Rows below `minSimilarity` stay unpaired.
 */
export function hungarian(options: {
  readonly key?: readonly string[];
  readonly minSimilarity?: number;
  readonly weights?: Readonly<Record<string, number>>;
  readonly maxCells?: number;
} = {}): ArrayRule {
  if (options.key !== undefined && options.key.length === 0) throw new RangeError("hungarian: key must name at least one field.");
  for (const [field, weight] of Object.entries(options.weights ?? {})) {
    if (!(Number.isFinite(weight) && weight >= 0)) throw new RangeError(`hungarian: weight for ${field} must be a finite number of at least 0.`);
  }
  return {
    kind: "hungarian",
    minSimilarity: unitInterval("hungarian", "minSimilarity", options.minSimilarity) ?? 0.5,
    maxCells: budget("hungarian", options.maxCells),
    ...(options.key === undefined ? {} : { key: [...options.key] }),
    ...(options.weights === undefined ? {} : { weights: { ...options.weights } }),
  };
}

/** The serializable description of a rule, for explain output and fingerprints. */
export function describeArrayRule(rule: ArrayRule): { readonly text: string; readonly json: JsonValue } {
  switch (rule.kind) {
    case "index":
      return { text: "byIndex()", json: { kind: "index" } };
    case "ordered":
      return { text: `ordered(minSimilarity ${rule.minSimilarity})`, json: { kind: "ordered", minSimilarity: rule.minSimilarity, maxCells: rule.maxCells } };
    case "hungarian": {
      const parts = [
        ...(rule.key === undefined ? [] : [`key ${rule.key.join(", ")}`]),
        `minSimilarity ${rule.minSimilarity}`,
        ...(rule.weights === undefined ? [] : [`weights ${JSON.stringify(rule.weights)}`]),
      ];
      return {
        text: `hungarian(${parts.join("; ")})`,
        json: {
          kind: "hungarian",
          minSimilarity: rule.minSimilarity,
          maxCells: rule.maxCells,
          ...(rule.key === undefined ? {} : { key: [...rule.key] }),
          ...(rule.weights === undefined ? {} : { weights: { ...rule.weights } }),
        },
      };
    }
  }
}
