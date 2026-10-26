import type { Aggregate } from "./report.js";

export interface GateOptions {
  readonly minF1?: number;
  /** Cost requires a pricing table; unpriced usage is not included in this total. */
  readonly maxCostUsd?: number;
}

export interface GateResult {
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

function dollars(value: number): string {
  const fixed = value.toFixed(4);
  return "$" + (Number(fixed) === value ? fixed : String(value));
}

/** Evaluate independent accuracy and priced-cost thresholds. Equality passes. */
export function gate(
  summary: Pick<Aggregate, "meanF1" | "totalCostUsd">,
  options: GateOptions = {},
): GateResult {
  const { minF1, maxCostUsd } = options;
  if (minF1 !== undefined && (!Number.isFinite(minF1) || minF1 < 0 || minF1 > 1)) {
    throw new RangeError("minF1 must be a finite number between 0 and 1.");
  }
  if (maxCostUsd !== undefined && (!Number.isFinite(maxCostUsd) || maxCostUsd < 0)) {
    throw new RangeError("maxCostUsd must be a finite nonnegative number.");
  }
  const reasons: string[] = [];
  if (minF1 !== undefined && summary.meanF1 < minF1) {
    reasons.push(`Mean F1 ${summary.meanF1.toFixed(3)} is below the --min-f1 gate of ${minF1}.`);
  }
  if (maxCostUsd !== undefined && summary.totalCostUsd > maxCostUsd) {
    reasons.push(`Total cost ${dollars(summary.totalCostUsd)} exceeds the --max-cost-usd gate of ${dollars(maxCostUsd)}.`);
  }
  return { pass: reasons.length === 0, reasons };
}
