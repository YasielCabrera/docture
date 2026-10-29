import type { CaseResult } from "../../result/types.js";
import { NOT_AVAILABLE, formatCount, formatMs, formatNumber, formatPercent, formatUsd } from "./format.js";

/** A raw column value. Numbers sort numerically; `null` means there is no value for this row. */
export type CellValue = string | number | boolean | null;

/**
 * One column of the per-case table, shared by the terminal, Markdown, CSV and the HTML documents table.
 * `priority` 1 is always shown; narrow terminals drop the highest numbers first.
 */
export interface Column {
  readonly id: string;
  readonly header: string;
  value(row: CaseResult): CellValue;
  format?(value: CellValue, row: CaseResult): string;
  readonly priority?: number;
}

/** Declare a column. Identity at runtime; it pins the type. */
export function defineColumn(column: Column): Column {
  return column;
}

/** The column's text for one row, through its `format` or the plain rendering of its value. */
export function cellText(column: Column, row: CaseResult): string {
  const value = column.value(row);
  if (column.format) return column.format(value, row);
  if (value === null) return NOT_AVAILABLE;
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}

/** Whether the column's values are numbers, judged from the rows that have one. */
export function isNumericColumn(column: Column, rows: readonly CaseResult[]): boolean {
  const values = rows.map((row) => column.value(row)).filter((value) => value !== null);
  return values.length > 0 && values.every((value) => typeof value === "number");
}

function metric(row: CaseResult, id: "f1" | "precision" | "recall"): number | null {
  const recorded = row.values?.[id];
  if (recorded !== undefined) return recorded;
  return row.outcome === "scored" ? row.score.metrics[id] : null;
}

const percent = (value: CellValue): string => formatPercent(typeof value === "number" ? value : null);

/** Mismatched, omitted and hallucinated leaves of a scored case. */
export function problemCount(row: CaseResult): number | null {
  if (row.outcome !== "scored") return null;
  const { mismatch, omission, hallucination } = row.score.counts;
  return mismatch + omission + hallucination;
}

/** What went wrong in a row that has no score: the error or the skip reason. */
export function rowMessage(row: CaseResult): string {
  if (row.outcome === "errored") return `${row.error.name}: ${row.error.message}`;
  if (row.outcome === "skipped") return row.reason;
  return "";
}

/** The columns every per-case view starts from. */
export function defaultColumns(): readonly Column[] {
  return [
    { id: "case", header: "Case", priority: 1, value: (row) => row.caseId },
    { id: "experiment", header: "Experiment", priority: 1, value: (row) => row.experiment },
    { id: "epoch", header: "Epoch", priority: 4, value: (row) => row.epoch },
    { id: "outcome", header: "Outcome", priority: 1, value: (row) => row.outcome },
    { id: "f1", header: "F1", priority: 1, value: (row) => metric(row, "f1"), format: percent },
    { id: "precision", header: "Precision", priority: 3, value: (row) => metric(row, "precision"), format: percent },
    { id: "recall", header: "Recall", priority: 3, value: (row) => metric(row, "recall"), format: percent },
    { id: "problems", header: "Problems", priority: 2, value: problemCount, format: (value) => formatCount(typeof value === "number" ? value : null) },
    { id: "ms", header: "Time", priority: 4, value: (row) => row.ms, format: (value) => formatMs(typeof value === "number" ? value : null) },
    { id: "cost", header: "Cost", priority: 5, value: (row) => row.usage?.costUsd ?? null, format: (value) => formatUsd(typeof value === "number" ? value : null) },
    { id: "message", header: "Message", priority: 1, value: rowMessage, format: (value) => (typeof value === "string" ? value : "") },
  ];
}
