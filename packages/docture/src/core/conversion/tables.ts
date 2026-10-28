import type { ElementProvenance, TableCellSpan, TableElement } from "../domain/conversion.js";
import type { ValidationIssue } from "../domain/result.js";
import { withContinuation } from "./provenance.js";

type TableShape = Pick<TableElement, "rows" | "headerRows" | "spans">;

/** Every rule a table's `rows`, `headerRows` and `spans` must satisfy together. */
export function tableIssues(table: TableShape, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { rows, headerRows, spans } = table;
  if (headerRows > rows.length) {
    issues.push({ path: `${path}.headerRows`, message: `must be at most the row count ${rows.length}` });
  }
  if (spans === undefined) return issues;
  const width = rows[0]?.length ?? 0;
  rows.forEach((row, index) => {
    if (row.length !== width) issues.push({ path: `${path}.rows.${index}`, message: `must have ${width} cells like row 0 when spans are present` });
  });
  if (issues.length > 0) return issues;
  const owner: (number | undefined)[][] = rows.map((row) => row.map(() => undefined));
  spans.forEach((span, index) => {
    const at = `${path}.spans.${index}`;
    const previous = spans[index - 1];
    if (previous !== undefined && (previous.row > span.row || (previous.row === span.row && previous.col >= span.col))) {
      issues.push({ path: at, message: "must follow the previous span in row, then column order" });
    }
    if (span.rowSpan === 1 && span.colSpan === 1) issues.push({ path: at, message: "must cover more than one cell" });
    if (span.row + span.rowSpan > rows.length || span.col + span.colSpan > width) {
      issues.push({ path: at, message: `must fit inside the ${rows.length}x${width} table` });
      return;
    }
    if (span.row < headerRows && span.row + span.rowSpan > headerRows) {
      issues.push({ path: at, message: `must not cross the header boundary at row ${headerRows}` });
    }
    for (let row = span.row; row < span.row + span.rowSpan; row += 1) {
      for (let col = span.col; col < span.col + span.colSpan; col += 1) {
        const other = owner[row]?.[col];
        if (other !== undefined) {
          issues.push({ path: at, message: `overlaps span ${other} at row ${row}, column ${col}` });
          return;
        }
        (owner[row] ?? [])[col] = index;
        if ((row !== span.row || col !== span.col) && rows[row]?.[col] !== "") {
          issues.push({ path: `${path}.rows.${row}.${col}`, message: `must be "" because span ${index} covers it` });
        }
      }
    }
  });
  return issues;
}

/**
 * The table as one header row followed by body rows, the shape of a GFM table.
 * Each column joins its distinct non-empty header labels top-down with `" / "`,
 * and a spanning header label counts for every column it covers. Body slots a span
 * covers stay `""`. With `headerRows` 0 the rows are returned unchanged, and the
 * first row is read as the header.
 */
export function flattenHeaderRows(table: TableShape): readonly (readonly string[])[] {
  if (table.headerRows === 0) return table.rows;
  const width = Math.max(...table.rows.map((row) => row.length));
  const labels: string[][] = Array.from({ length: width }, () => []);
  table.rows.slice(0, table.headerRows).forEach((row, rowIndex) => {
    for (let col = 0; col < width; col += 1) {
      const anchor = anchorAt(table, rowIndex, col);
      const label = table.rows[anchor.row]?.[anchor.col] ?? "";
      const column = labels[col] ?? [];
      if (label !== "" && !column.includes(label)) column.push(label);
    }
  });
  return [labels.map((column) => column.join(" / ")), ...table.rows.slice(table.headerRows)];
}

/** The anchor of the span covering a slot, or the slot itself. */
export function anchorAt(table: Pick<TableElement, "spans">, row: number, col: number): { readonly row: number; readonly col: number } {
  const span = table.spans?.find((candidate) =>
    row >= candidate.row && row < candidate.row + candidate.rowSpan &&
    col >= candidate.col && col < candidate.col + candidate.colSpan);
  return span === undefined ? { row, col } : { row: span.row, col: span.col };
}

/**
 * Rows `start` to `end` (exclusive) as their own table. Spans are clipped to the
 * slice and rebased; a clipped span whose anchor lies above the slice moves its
 * text to the slice's first covered row. `rowProvenance` is sliced with the rows;
 * `sourceText` is dropped because it is not row-aligned.
 */
export function sliceTableRows(table: TableElement, start: number, end: number): TableElement {
  const rows = table.rows.slice(start, end).map((row) => [...row]);
  const spans: TableCellSpan[] = [];
  for (const span of table.spans ?? []) {
    const top = Math.max(span.row, start);
    const bottom = Math.min(span.row + span.rowSpan, end);
    if (top >= bottom) continue;
    const rebased = { row: top - start, col: span.col, rowSpan: bottom - top, colSpan: span.colSpan };
    if (top !== span.row) {
      const row = rows[rebased.row];
      if (row !== undefined) row[span.col] = table.rows[span.row]?.[span.col] ?? "";
    }
    if (rebased.rowSpan > 1 || rebased.colSpan > 1) spans.push(rebased);
  }
  return {
    id: table.id,
    kind: "table",
    rows,
    headerRows: Math.max(0, Math.min(table.headerRows, end) - start),
    ...(spans.length === 0 ? {} : { spans }),
    ...(table.rowProvenance === undefined ? {} : { rowProvenance: table.rowProvenance.slice(start, end) }),
    provenance: table.provenance,
  };
}

/**
 * `base` followed by the rows of `next`, which become body rows. Undefined when the
 * result would break a table rule, for example spans over rows of different widths.
 * `rowProvenance` is kept only when both tables have it. With `continuation`, the
 * rows come from a later page and its segment joins `base`'s provenance; without
 * it, provenance is the caller's to merge.
 */
export function appendTableRows(
  base: TableElement,
  next: Pick<TableElement, "rows" | "spans" | "rowProvenance" | "sourceText">,
  continuation?: ElementProvenance,
): TableElement | undefined {
  const offset = base.rows.length;
  const spans = [
    ...(base.spans ?? []),
    ...(next.spans ?? []).map((span) => ({ ...span, row: span.row + offset })),
  ];
  const sourceText = [base.sourceText, next.sourceText].filter((text) => text !== undefined);
  const rowProvenance = base.rowProvenance !== undefined && next.rowProvenance !== undefined
    ? [...base.rowProvenance, ...next.rowProvenance]
    : undefined;
  const merged: TableElement = {
    id: base.id,
    kind: "table",
    rows: [...base.rows, ...next.rows],
    headerRows: base.headerRows,
    ...(spans.length === 0 ? {} : { spans }),
    ...(rowProvenance === undefined ? {} : { rowProvenance }),
    ...(sourceText.length === 0 ? {} : { sourceText: sourceText.join("\n") }),
    provenance: continuation === undefined ? base.provenance : withContinuation(base.provenance, continuation),
  };
  return tableIssues(merged, "").length === 0 ? merged : undefined;
}
