import type { CaseResult } from "../../result/types.js";
import { cellText, isNumericColumn, type Column } from "../shared/columns.js";
import type { TableView } from "../shared/views.js";

/** Render data controls visibly, leaving terminal commands exclusively to the reporter. */
export function escapeTerminal(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, (control) => `\\x${control.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** A summary table as aligned plain text, with its title and notes. */
export function textTable(source: TableView): string {
  const view = {
    ...source,
    title: escapeTerminal(source.title),
    columns: source.columns.map(escapeTerminal),
    rows: source.rows.map((row) => row.map(escapeTerminal)),
    notes: source.notes.map(escapeTerminal),
  };
  const widths = view.columns.map((column, index) => Math.max(column.length, ...view.rows.map((row) => (row[index] ?? "").length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => (view.numeric[index] ? cell.padStart(widths[index]!) : cell.padEnd(widths[index]!)))
      .join("  ")
      .trimEnd();
  return [
    view.title,
    `  ${line(view.columns)}`,
    `  ${widths.map((width) => "-".repeat(width)).join("  ")}`,
    ...view.rows.map((row) => `  ${line(row)}`),
    ...view.notes.map((note) => `  ${note}`),
  ].join("\n");
}

function dropLowestPriorityUntilFits<T extends { readonly priority: number }>(
  items: readonly T[],
  tooWide: (kept: readonly T[]) => boolean,
): readonly T[] {
  let kept = items;
  while (tooWide(kept)) {
    const lowest = kept.reduce<T | undefined>(
      (worst, item) => (item.priority > 1 && (worst === undefined || item.priority > worst.priority) ? item : worst),
      undefined,
    );
    if (lowest === undefined) break;
    kept = kept.filter((item) => item !== lowest);
  }
  return kept;
}

/** One case as a line for a progress log. Numeric cells carry their header, such as `F1 92.3%`, since there is no header row; missing values are left out. */
export function caseLine(row: CaseResult, columns: readonly Column[], width: number): string {
  const cells = columns.flatMap((column) => {
    const value = column.value(row);
    const text = escapeTerminal(cellText(column, row));
    if (value === null || text === "") return [];
    return [{ text: typeof value === "number" ? `${escapeTerminal(column.header)} ${text}` : text, priority: column.priority ?? 1 }];
  });
  const length = (kept: readonly { readonly text: string }[]): number =>
    kept.reduce((sum, cell) => sum + cell.text.length, 0) + 2 * Math.max(0, kept.length - 1);
  return dropLowestPriorityUntilFits(cells, (kept) => length(kept) > width)
    .map((cell) => cell.text)
    .join("  ");
}

/** Cases as an aligned table: a header line, then one line per row. Narrow widths drop low-priority columns. */
export function caseTable(
  rows: readonly CaseResult[],
  columns: readonly Column[],
  width: number,
): { readonly header: string; readonly lines: readonly string[] } {
  const all = columns.map((source) => {
    const column = { ...source, header: escapeTerminal(source.header) };
    const texts = rows.map((row) => escapeTerminal(cellText(column, row)));
    return {
      column,
      texts,
      numeric: isNumericColumn(column, rows),
      width: Math.max(column.header.length, ...texts.map((text) => text.length)),
      priority: column.priority ?? 1,
    };
  });
  const kept = dropLowestPriorityUntilFits(
    all,
    (list) => list.reduce((sum, entry) => sum + entry.width, 0) + 2 * Math.max(0, list.length - 1) > width,
  );
  const pad = (entry: (typeof all)[number], text: string): string =>
    entry.numeric ? text.padStart(entry.width) : text.padEnd(entry.width);
  return {
    header: kept
      .map((entry) => pad(entry, entry.column.header))
      .join("  ")
      .trimEnd(),
    lines: rows.map((_row, index) =>
      kept
        .map((entry) => pad(entry, entry.texts[index] ?? ""))
        .join("  ")
        .trimEnd(),
    ),
  };
}

/** A span of time: `48s`, `4m 09s`, `1h 04m`. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "n/a";
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
