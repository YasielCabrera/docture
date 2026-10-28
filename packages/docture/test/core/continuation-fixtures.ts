import type { LoadedDocument, LoadedPage, TextSpan } from "../../src/core/index.js";
import { line, span } from "./conversion-fixtures.js";

export interface FixtureLine {
  readonly y: number;
  readonly cells: readonly (readonly [string, number])[];
  readonly bold?: boolean;
}

export const row = (y: number, ...cells: readonly (readonly [string, number])[]): FixtureLine => ({ y, cells });
export const boldRow = (y: number, ...cells: readonly (readonly [string, number])[]): FixtureLine => ({ y, cells, bold: true });
export const text = (y: number, value: string): FixtureLine => ({ y, cells: [[value, 40]] });
export const pageNumberFooter = (pageNumber: number): FixtureLine => ({ y: 770, cells: [[`Page ${pageNumber}`, 280]] });

export function fixturePage(pageNumber: number, items: readonly FixtureLine[]): LoadedPage {
  const lines = items.map((item) => line(item.y, item.cells.map(([value, x]): TextSpan =>
    span(value, x, item.y, { style: { fontSize: 11, ...(item.bold === true ? { bold: true } : {}) } }))));
  return {
    pageNumber,
    width: 600,
    height: 800,
    text: lines.map((item) => item.text).join("\n"),
    lines,
    blocks: lines.map((item, index) => {
      const x = Math.min(...item.spans.map((cell) => cell.x));
      const right = Math.max(...item.spans.map((cell) => cell.x + cell.width));
      return { id: `p${pageNumber}-text-${index + 1}`, kind: "text" as const, x, y: item.y, width: right - x, height: 12, lines: [item] };
    }),
  };
}

export function fixtureDocument(...pages: readonly (readonly FixtureLine[])[]): LoadedDocument {
  const loaded = pages.map((items, index) => fixturePage(index + 1, items));
  return { loader: "continuation-fixture", form: "digital", text: loaded.map((page) => page.text).join("\f"), pages: loaded };
}

export const tableAtPageBottom: readonly FixtureLine[] = [
  row(640, ["Item", 40], ["Amount", 200]),
  row(660, ["Alpha", 40], ["10", 200]),
  row(680, ["Beta", 40], ["20", 200]),
];

export const continuationRows: readonly FixtureLine[] = [
  row(100, ["Gamma", 40], ["30", 200]),
  row(120, ["Delta", 40], ["40", 200]),
  row(140, ["Epsilon", 40], ["50", 200]),
];

export const repeatedHeaderRows: readonly FixtureLine[] = [
  row(100, ["Item", 40], ["Amount", 200]),
  row(120, ["Gamma", 40], ["30", 200]),
  row(140, ["Delta", 40], ["40", 200]),
  row(160, ["Epsilon", 40], ["50", 200]),
];

export const twoRowFragment: readonly FixtureLine[] = [
  row(100, ["Gamma", 40], ["30", 200]),
  row(120, ["Delta", 40], ["40", 200]),
  text(300, "Amounts are in thousands."),
];

export const otherColumnRows: readonly FixtureLine[] = [
  row(100, ["Gamma", 300], ["30", 450]),
  row(120, ["Delta", 300], ["40", 450]),
  row(140, ["Epsilon", 300], ["50", 450]),
];

export const twoColumnProse: readonly FixtureLine[] = [
  row(100, ["Revenue rose in the north,", 40], ["while costs in the south held steady through the year.", 200]),
  row(120, ["and the west was flat.", 40], ["The east region reported a small loss in the third quarter.", 200]),
  row(140, ["Exports grew again.", 40], ["Imports fell for the second year in a row across the group.", 200]),
];

export const ownHeaderTable: readonly FixtureLine[] = [
  boldRow(100, ["Code", 40], ["Units", 200]),
  row(120, ["A1", 40], ["3", 200]),
  row(140, ["B2", 40], ["4", 200]),
];

export const tableAtPageTop: readonly FixtureLine[] = [
  row(100, ["Item", 40], ["Amount", 200]),
  row(120, ["Alpha", 40], ["10", 200]),
  row(140, ["Beta", 40], ["20", 200]),
];

export const fullPageRows: readonly FixtureLine[] = Array.from({ length: 30 }, (_unused, index) =>
  row(100 + index * 20, [`Row ${index + 1}`, 40], [String(index + 1), 200]));

export const unfinishedParagraph = text(690, "Revenue grew in every region, and the board expects that");

export const rowsFromPageTop: readonly FixtureLine[] = [
  row(40, ["Gamma", 40], ["30", 200]),
  row(60, ["Delta", 40], ["40", 200]),
  row(80, ["Epsilon", 40], ["50", 200]),
];

export const denseFormStart: readonly FixtureLine[] = [
  text(50, "Reconciliation form"),
  text(64, "balance as shown on your"),
  text(78, "statement and register."),
];

export const threeColumnTableAtPageBottom: readonly FixtureLine[] = [
  row(640, ["Item", 40], ["Qty", 200], ["Amount", 300]),
  row(660, ["Alpha", 40], ["1", 200], ["10", 300]),
  row(680, ["Beta", 40], ["2", 200], ["20", 300]),
];

export const rowsThenTotal: readonly FixtureLine[] = [
  row(100, ["Gamma", 40], ["3", 200], ["30", 300]),
  row(120, ["Total", 200], ["60", 300]),
  text(200, "Prices include tax."),
];
