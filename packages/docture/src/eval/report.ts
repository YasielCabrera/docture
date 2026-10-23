/**
 * Turning scores into something a human reads and CI can gate on.
 */

import type { Attempt, ExtractionResult, Usage } from "../core/index.js";
import { failures, type Score } from "./scorer.js";

export interface RunRecord {
  /** Document identifier — a file name, a fixture seed, anything stable. */
  readonly document: string;
  readonly score: Score;
  readonly method: string;
  readonly loader: string;
  readonly usage: Usage;
  readonly attempts: readonly Attempt[];
}

export interface Aggregate {
  readonly documents: number;
  readonly meanF1: number;
  readonly meanPrecision: number;
  readonly meanRecall: number;
  readonly exactMatches: number;
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly wallMs: number;
  /** How many documents each strategy answered — the fallback picture. */
  readonly byMethod: Readonly<Record<string, number>>;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Fold a run into one record, ready for aggregation or a report. */
export function recordRun(
  document: string,
  score: Score,
  result: Pick<ExtractionResult<unknown>, "method" | "loader" | "usage" | "attempts">,
): RunRecord {
  return {
    document,
    score,
    method: result.method,
    loader: result.loader,
    usage: result.usage,
    attempts: result.attempts,
  };
}

export function aggregate(records: readonly RunRecord[]): Aggregate {
  const byMethod: Record<string, number> = {};
  for (const record of records) {
    byMethod[record.method] = (byMethod[record.method] ?? 0) + 1;
  }

  return {
    documents: records.length,
    meanF1: mean(records.map((r) => r.score.f1)),
    meanPrecision: mean(records.map((r) => r.score.precision)),
    meanRecall: mean(records.map((r) => r.score.recall)),
    exactMatches: records.filter((r) => r.score.exactMatch).length,
    totalCostUsd: records.reduce((sum, r) => sum + (r.usage.costUsd ?? 0), 0),
    totalTokens: records.reduce((sum, r) => sum + r.usage.totalTokens, 0),
    wallMs: records.reduce((sum, r) => sum + r.usage.wallMs, 0),
    byMethod,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** A Markdown scoreboard. Stable ordering, so a diff is readable in review. */
export function formatScoreboard(records: readonly RunRecord[]): string {
  const summary = aggregate(records);
  const rows = [...records].sort((a, b) => a.document.localeCompare(b.document));

  const lines = [
    "| Document | F1 | Precision | Recall | Exact | Method | Miss |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) =>
      [
        r.document,
        r.score.f1.toFixed(3),
        percent(r.score.precision),
        percent(r.score.recall),
        r.score.exactMatch ? "yes" : "no",
        r.method,
        String(failures(r.score).length),
      ].join(" | "),
    ),
    "",
    `**${summary.documents} documents** · mean F1 ${summary.meanF1.toFixed(3)} · ` +
      `${summary.exactMatches} exact · ${summary.totalTokens} tokens · ` +
      `$${summary.totalCostUsd.toFixed(4)} · ${summary.wallMs}ms`,
  ];

  const methods = Object.entries(summary.byMethod);
  if (methods.length > 1) {
    lines.push("", `Answered by: ${methods.map(([m, n]) => `${m} (${n})`).join(", ")}`);
  }
  return lines.join("\n");
}

/** The failing fields of one run, for a test message or a terminal. */
export function formatFailures(score: Score, limit = 20): string {
  const wrong = failures(score);
  if (wrong.length === 0) return "All fields matched.";

  const shown = wrong.slice(0, limit).map((f) => {
    const expected = JSON.stringify(f.expected);
    const actual = JSON.stringify(f.actual);
    return `  ${f.status.padEnd(13)} ${f.path}: expected ${expected}, got ${actual}`;
  });

  // Never let a truncated list read as a complete one.
  if (wrong.length > limit) shown.push(`  … and ${wrong.length - limit} more`);
  return [`${wrong.length} field(s) did not match:`, ...shown].join("\n");
}
