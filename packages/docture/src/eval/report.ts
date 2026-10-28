/**
 * Turning scores into something a human reads and CI can gate on.
 */

import type { Attempt, ExtractionResult, Usage } from "../core/index.js";
import { failures, type FieldStatus, type Score } from "./scorer.js";

export interface RunRecord {
  /** Document identifier — a file name, a fixture seed, anything stable. */
  readonly document: string;
  readonly score: Score;
  readonly method: string;
  readonly loader: string;
  readonly usage: Usage;
  readonly attempts: readonly Attempt[];
  readonly citations?: ExtractionResult<unknown>["citations"];
  readonly citationSources?: ExtractionResult<unknown>["citationSources"];
  readonly evidenceSources?: ExtractionResult<unknown>["evidenceSources"];
  readonly sourceDigest?: string;
  readonly physicalSourceDigest?: string;
  readonly sourceMetadata?: Readonly<Record<string, unknown>>;
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
  readonly byField: Readonly<Record<string, FieldAggregate>>;
}

export interface FieldAggregate {
  readonly match: number;
  readonly mismatch: number;
  readonly omission: number;
  readonly hallucination: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Fold a run into one record, ready for aggregation or a report. */
export function recordRun(
  document: string,
  score: Score,
  result: Pick<ExtractionResult<unknown>, "method" | "loader" | "usage" | "attempts" | "citations" | "citationSources" | "evidenceSources" | "sourceDigest" | "physicalSourceDigest" | "sourceMetadata">,
): RunRecord {
  return {
    document,
    score,
    method: result.method,
    loader: result.loader,
    usage: result.usage,
    attempts: result.attempts,
    ...(result.citations === undefined ? {} : { citations: result.citations }),
    ...(result.citationSources === undefined ? {} : { citationSources: result.citationSources }),
    ...(result.evidenceSources === undefined ? {} : { evidenceSources: result.evidenceSources }),
    ...(result.sourceDigest === undefined ? {} : { sourceDigest: result.sourceDigest }),
    ...(result.physicalSourceDigest === undefined ? {} : { physicalSourceDigest: result.physicalSourceDigest }),
    ...(result.sourceMetadata === undefined ? {} : { sourceMetadata: result.sourceMetadata }),
  };
}

export function aggregate(records: readonly RunRecord[]): Aggregate {
  const byMethod = new Map<string, number>();
  const byField = new Map<string, Record<FieldStatus, number>>();
  for (const record of records) {
    byMethod.set(record.method, (byMethod.get(record.method) ?? 0) + 1);
    for (const field of record.score.fields) {
      const path = field.path.replace(/\[\d+\]/g, "[]");
      const counts = byField.get(path) ?? { match: 0, mismatch: 0, omission: 0, hallucination: 0 };
      counts[field.status]++;
      byField.set(path, counts);
    }
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
    byMethod: Object.fromEntries(byMethod),
    byField: Object.fromEntries([...byField].map(([path, counts]) => {
      const predicted = counts.match + counts.mismatch + counts.hallucination;
      const relevant = counts.match + counts.mismatch + counts.omission;
      const precision = predicted === 0 ? 1 : counts.match / predicted;
      const recall = relevant === 0 ? 1 : counts.match / relevant;
      const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
      return [path, { ...counts, precision, recall, f1 }];
    })),
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
