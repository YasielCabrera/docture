import type { AlignmentReport } from "../../align/align.js";
import type { RepairHint } from "../../compare/types.js";
import type { CaseResult } from "../../result/types.js";
import type { FieldResult, FieldStatus } from "../../score/types.js";
import { formatValue } from "./format.js";

/** One leaf that did not match, with display text for both sides. */
export interface FieldDiff {
  readonly path: string;
  readonly status: Exclude<FieldStatus, "match">;
  readonly expected: string;
  readonly actual: string;
  readonly hint?: string;
  readonly note?: string;
}

/** `date-format (day and month swapped)`. */
export function describeHint(hint: RepairHint | undefined): string | undefined {
  if (hint === undefined) return undefined;
  return hint.detail === undefined ? hint.kind : `${hint.kind} (${hint.detail})`;
}

function diffOf(field: FieldResult): FieldDiff | undefined {
  if (field.status === "match") return undefined;
  const hint = describeHint(field.hint);
  return {
    path: field.path,
    status: field.status,
    expected: field.status === "hallucination" ? "" : formatValue(field.expected),
    actual: field.status === "omission" ? "" : formatValue(field.actual),
    ...(hint === undefined ? {} : { hint }),
    ...(field.note === undefined ? {} : { note: field.note }),
  };
}

/** The leaves of a scored case that did not match, in scoring order. Empty for other outcomes. */
export function fieldDiffs(row: CaseResult): readonly FieldDiff[] {
  if (row.outcome !== "scored") return [];
  return row.score.fields.map(diffOf).filter((diff): diff is FieldDiff => diff !== undefined);
}

/** Arrays whose rows were missing, extra, out of order, split or merged. */
export function rowDefects(row: CaseResult): readonly AlignmentReport[] {
  if (row.outcome !== "scored") return [];
  return row.score.arrays.filter((report) => report.missing + report.extra + report.outOfOrder + report.splits.length + report.merges.length > 0);
}

/** `lineItems: 2 of 3 rows matched, 1 missing, 1 out of order`. */
export function describeRows(report: AlignmentReport): string {
  const parts = [`${report.matched} of ${report.expected} rows matched`];
  if (report.missing > 0) parts.push(`${report.missing} missing`);
  if (report.extra > 0) parts.push(`${report.extra} extra`);
  if (report.outOfOrder > 0) parts.push(`${report.outOfOrder} out of order`);
  if (report.splits.length > 0) parts.push(`${report.splits.length} split`);
  if (report.merges.length > 0) parts.push(`${report.merges.length} merged`);
  return `${report.path}: ${parts.join(", ")}`;
}

/** Failed cross-field assertions as `id: message`. */
export function assertionFailures(row: CaseResult): readonly string[] {
  if (row.outcome !== "scored") return [];
  return row.score.assertions.flatMap((assertion) => (assertion.status === "fail" ? [`${assertion.id}: ${assertion.message}`] : []));
}

/** Errored, or scored with any leaf or assertion that did not pass. Skipped cases are not failures. */
export function isFailure(row: CaseResult): boolean {
  if (row.outcome === "errored") return true;
  if (row.outcome === "skipped") return false;
  return !row.score.metrics.exact || row.score.assertions.some((assertion) => assertion.status === "fail");
}

/** `totals.tax: mismatch, expected 5.7, got 5.9 (hint: scale)`. */
export function describeDiff(diff: FieldDiff): string {
  const sides = diff.status === "omission"
    ? `expected ${diff.expected}`
    : diff.status === "hallucination"
      ? `got ${diff.actual}`
      : `expected ${diff.expected}, got ${diff.actual}`;
  const extras = [diff.hint === undefined ? undefined : `hint: ${diff.hint}`, diff.note].filter((part) => part !== undefined);
  return `${diff.path}: ${diff.status}, ${sides}${extras.length > 0 ? ` (${extras.join("; ")})` : ""}`;
}

/** Everything wrong with a case as plain lines: the error, field diffs, row defects and failed assertions. */
export function diffLines(row: CaseResult): readonly string[] {
  if (row.outcome === "errored") return [`error: ${row.error.name}${row.error.code === undefined ? "" : ` [${row.error.code}]`}: ${row.error.message}`];
  if (row.outcome === "skipped") return [`skipped: ${row.reason}`];
  return [
    ...fieldDiffs(row).map(describeDiff),
    ...rowDefects(row).map(describeRows),
    ...assertionFailures(row).map((failure) => `assertion ${failure}`),
  ];
}
