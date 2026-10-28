import type { LoadedDocument, LoadedPage, TextSpan } from "../../src/core/index.js";
import { line, span } from "./conversion-fixtures.js";

export type Cell = readonly [string, number] | readonly [string, number, number];

export interface TableRow {
  readonly y: number;
  readonly cells: readonly Cell[];
}

export function tablePage(rows: readonly TableRow[], pageNumber = 1): LoadedPage {
  const lines = rows.map((row) => line(row.y, row.cells.map(([text, x, height]): TextSpan =>
    span(text, x, row.y, { style: { fontSize: 11 }, ...(height === undefined ? {} : { height }) }))));
  return {
    pageNumber,
    width: 600,
    height: 800,
    text: lines.map((item) => item.text).join("\n"),
    lines,
    blocks: lines.map((item, index) => {
      const x = Math.min(...item.spans.map((cell) => cell.x));
      const right = Math.max(...item.spans.map((cell) => cell.x + cell.width));
      const bottom = Math.max(...item.spans.map((cell) => cell.y + cell.height));
      return {
        id: `p${pageNumber}-text-${index + 1}`,
        kind: "text" as const,
        x,
        y: item.y,
        width: right - x,
        height: bottom - item.y,
        lines: [item],
      };
    }),
  };
}

export function tableDocument(...rows: readonly (readonly TableRow[])[]): LoadedDocument {
  const pages = rows.map((page, index) => tablePage(page, index + 1));
  return { loader: "table-fixture", form: "digital", text: pages.map((page) => page.text).join("\f"), pages };
}

export const groupHeaderRows: readonly TableRow[] = [
  { y: 100, cells: [["Item", 40], ["Quarters", 200]] },
  { y: 120, cells: [["Q1", 200], ["Q2", 230]] },
  { y: 140, cells: [["Alpha", 40], ["10", 200], ["20", 230]] },
  { y: 160, cells: [["Beta", 40], ["30", 200], ["40", 230]] },
];

export function regionRows(northHeight: number): readonly TableRow[] {
  return [
    { y: 100, cells: [["Region", 40], ["Q1", 200], ["Q2", 230]] },
    { y: 120, cells: [["North", 40, northHeight], ["10", 200], ["20", 230]] },
    { y: 138, cells: [["11", 200], ["21", 230]] },
    { y: 160, cells: [["South", 40], ["30", 200], ["40", 230]] },
  ];
}

export const overflowingDescriptionRows: readonly TableRow[] = [
  { y: 100, cells: [["Item", 40], ["Qty", 200], ["Price", 260]] },
  { y: 120, cells: [["Widget", 40], ["2", 200], ["9.50", 260]] },
  { y: 140, cells: [["Consulting services for the audit", 40], ["120.00", 260]] },
  { y: 160, cells: [["Gadget", 40], ["1", 200], ["4.25", 260]] },
];

export const uniformRows: readonly TableRow[] = [
  { y: 100, cells: [["Name", 40], ["Units", 200], ["Total", 300]] },
  { y: 120, cells: [["Alpha", 40], ["3", 200], ["30", 300]] },
  { y: 140, cells: [["Beta", 40], ["4", 200], ["40", 300]] },
];

export const rightTableRows: readonly TableRow[] = [
  { y: 40, cells: [["Code", 300], ["Units", 400], ["Total", 500]] },
  { y: 60, cells: [["A1", 300], ["3", 400], ["30", 500]] },
  { y: 80, cells: [["B2", 300], ["4", 400], ["40", 500]] },
];

export const narrowTableRows: readonly TableRow[] = [
  { y: 200, cells: [["Name", 400], ["Value", 500]] },
  { y: 220, cells: [["Gamma", 400], ["7", 500]] },
  { y: 240, cells: [["Delta", 400], ["8", 500]] },
];

export const yearHeaderRows: readonly TableRow[] = [
  { y: 80, cells: [["FY 2024", 203], ["FY 2025", 303]] },
  { y: 100, cells: [["Item", 40], ["Q1", 200], ["Q2", 230], ["Q1", 300], ["Q2", 330]] },
  { y: 120, cells: [["Alpha", 40], ["10", 200], ["20", 230], ["11", 300], ["21", 330]] },
  { y: 140, cells: [["Beta", 40], ["30", 200], ["40", 230], ["31", 300], ["41", 330]] },
];

export const partiesAboveTableRows: readonly TableRow[] = [
  { y: 80, cells: [["Kestrel Ltd", 40], ["Pinnacle Oy", 260]] },
  ...uniformRows,
  { y: 160, cells: [["Total", 200], ["70", 300]] },
];

export const wordSpanRows: readonly TableRow[] = [
  { y: 100, cells: [["Drive", 40], ["belt", 70], ["#163", 200], ["4", 300]] },
  { y: 120, cells: [["Drive", 40], ["belt", 70], ["#164", 200], ["13", 300]] },
  { y: 140, cells: [["Pressure", 40], ["#165", 200], ["6", 300]] },
  { y: 160, cells: [["Drive", 40], ["belt", 70], ["#166", 200], ["15", 300]] },
];
