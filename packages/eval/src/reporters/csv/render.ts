import type { EvalResult } from "../../result/types.js";
import { defaultColumns, type CellValue, type Column } from "../shared/columns.js";
import { describeHint } from "../shared/diffs.js";
import { formatValue } from "../shared/format.js";

export interface CsvOptions {
  /** `case` writes one line per case; `field` one line per scored leaf. Default `case`. */
  readonly level?: "case" | "field";
  /** Columns of the `case` level. Default: the shared default columns. */
  readonly columns?: readonly Column[];
}

/**
 * One RFC 4180 field. Text that a spreadsheet would run as a formula (a leading `=`, `+`, `-`, `@`, tab or
 * carriage return) gets a leading `'`. Numbers are written as numbers.
 */
export function csvCell(value: CellValue): string {
  if (value === null) return "";
  if (typeof value !== "string") return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const line = (cells: readonly CellValue[]): string => `${cells.map(csvCell).join(",")}\r\n`;

const FIELD_HEADER = ["case", "experiment", "epoch", "path", "actualPath", "pattern", "segment", "status", "expected", "actual", "comparator", "similarity", "weight", "critical", "hint", "note", "confidence", "grounded"];

/** The result as CSV: one line per case with the report's columns, or one line per scored leaf. */
export function renderCsv(result: EvalResult, options: CsvOptions = {}): string {
  if (options.level === "field") {
    const lines = [line(FIELD_HEADER)];
    for (const row of result.cases) {
      if (row.outcome !== "scored") continue;
      for (const field of row.score.fields) {
        lines.push(line([
          row.caseId,
          row.experiment,
          row.epoch,
          field.path,
          field.actualPath ?? null,
          field.pattern,
          field.segment,
          field.status,
          field.status === "hallucination" ? null : formatValue(field.expected),
          field.status === "omission" ? null : formatValue(field.actual),
          field.comparator,
          field.similarity,
          field.weight,
          field.critical === true,
          describeHint(field.hint) ?? null,
          field.note ?? null,
          field.confidence ?? null,
          field.grounded ?? null,
        ]));
      }
    }
    return lines.join("");
  }
  const columns = options.columns ?? defaultColumns();
  return [line(columns.map((column) => column.header)), ...result.cases.map((row) => line(columns.map((column) => column.value(row))))].join("");
}
