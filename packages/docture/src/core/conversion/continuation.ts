import type { ElementProvenance, ParagraphElement, TableElement } from "../domain/conversion.js";
import type { LayoutBox, TextSpan } from "../domain/geometry.js";
import { fontSizes, isTableCandidate, median, type Candidate } from "./candidates.js";
import { bandOf } from "./furniture.js";
import { withContinuation } from "./provenance.js";
import {
  fitsBands,
  inferTableGrid,
  nextRowWithin,
  rowPitch,
  type ColumnBand,
  type TableGrid,
  type TableGroup,
} from "./table-grid.js";

const PAGE_EDGE = 0.25;
const WIDTH_TOLERANCE = 0.02;
const FONT_TOLERANCE = 0.1;
const MAX_CELL_LENGTH = 40;
const FINISHED = /[.!?:;]["'”’»)\]}]*$/u;

export interface PageFrame {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
}

/** What a continuation row must match, taken from the rows the table was detected from. */
export interface TableTraits {
  readonly bands: readonly ColumnBand[];
  readonly fontSize: number;
  readonly bold: boolean;
  /** The median step between the table's rows. */
  readonly pitch: number;
  /** Per band, whether its body cells all hold numbers without letters. */
  readonly numeric: readonly boolean[];
}

export interface TableTail extends TableTraits {
  readonly table: TableElement;
  /** The page and box of the table's last segment. */
  readonly page: PageFrame;
  readonly box: LayoutBox;
}

export interface TableContinuation {
  /** The candidates taken from the page, a dropped repeated header included. */
  readonly consumed: readonly Candidate[];
  /** The candidates that become body rows, one line each. */
  readonly rows: readonly Candidate[];
  /** Those rows on the table's columns. Its `headerRows` is meaningless here. */
  readonly grid: TableGrid;
}

const isBold = (spans: readonly TextSpan[]): boolean =>
  spans.length > 0 && spans.every((span) => span.style?.bold === true);

/** Pages without size have no positions, so nothing on them can continue. */
export function positioned(page: PageFrame): boolean {
  return page.width > 0 && page.height > 0;
}

function followsDirectly(previous: PageFrame, next: PageFrame): boolean {
  return positioned(previous) && positioned(next) && next.pageNumber === previous.pageNumber + 1;
}

function meetsAtPageBreak(previous: PageFrame, end: LayoutBox, next: PageFrame, start: LayoutBox): boolean {
  return followsDirectly(previous, next) &&
    end.y + end.height >= previous.height * (1 - PAGE_EDGE) &&
    start.y <= next.height * PAGE_EDGE;
}

const gap = (above: LayoutBox, below: LayoutBox): number => below.y - (above.y + above.height);

/** How many of `boxes`, top-down, are top-band lines set apart from the body. */
export function leadingBandLines(boxes: readonly LayoutBox[], pageHeight: number): number {
  let skip = 0;
  for (let count = 1; count <= boxes.length; count += 1) {
    const line = boxes[count - 1];
    if (line === undefined || bandOf(line, pageHeight) !== "page-header") break;
    const next = boxes[count];
    if (next === undefined || gap(line, next) >= line.height) skip = count;
  }
  return skip;
}

/** How many of `boxes`, in reading order, are bottom-band lines set apart from the body above. */
export function trailingBandLines(boxes: readonly LayoutBox[], pageHeight: number): number {
  let skip = 0;
  for (let count = 1; count <= boxes.length; count += 1) {
    const line = boxes[boxes.length - count];
    if (line === undefined || bandOf(line, pageHeight) !== "page-footer") break;
    const previous = boxes[boxes.length - count - 1];
    if (previous === undefined || gap(previous, line) >= line.height) skip = count;
  }
  return skip;
}

const numberLike = (text: string): boolean => /\p{N}/u.test(text) && !/\p{L}/u.test(text);

export function tableTraits(group: TableGroup): TableTraits | undefined {
  const { bands } = group;
  if (bands === undefined) return undefined;
  const lines = group.candidates.flatMap((candidate) => candidate.lines);
  const body = lines.length > group.headerRows ? lines.slice(group.headerRows) : lines;
  const spans = body.flatMap((line) => line.spans);
  const full = body.filter((line) => line.spans.length === bands.length);
  return {
    bands,
    fontSize: median(spans.flatMap((span) => span.style?.fontSize ?? [])),
    bold: isBold(spans),
    pitch: rowPitch(group.candidates.map((candidate) => candidate.box)),
    numeric: bands.map((_band, col) => {
      const cells = full.map((line) => line.spans[col]?.text.trim() ?? "").filter((text) => text !== "");
      return cells.length > 0 && cells.every(numberLike);
    }),
  };
}

function cellTexts(candidate: Candidate): string[] {
  return (candidate.lines[0]?.spans ?? []).map((span) => span.text.trim()).filter((text) => text !== "");
}

function repeatedHeaderLength(table: TableElement, body: readonly Candidate[]): number {
  const header = table.rows.slice(0, table.headerRows).map((row) => row.filter((cell) => cell !== ""));
  const repeated = header.length > 0 && header.every((labels, index) => {
    const candidate = body[index];
    const texts = candidate === undefined || candidate.lines.length !== 1 ? [] : cellTexts(candidate);
    return texts.length === labels.length && texts.every((text, col) => text === labels[col]);
  });
  return repeated ? header.length : 0;
}

function continuesRow(tail: TableTail, candidate: Candidate): boolean {
  const spans = candidate.lines[0]?.spans ?? [];
  if (candidate.lines.length !== 1 || !isTableCandidate(candidate) || spans.length !== tail.bands.length) return false;
  if (spans.some((span) => span.text.trim().length > MAX_CELL_LENGTH) || isBold(spans) !== tail.bold) return false;
  const size = median(fontSizes(candidate));
  if (tail.fontSize > 0 && Math.abs(size - tail.fontSize) > tail.fontSize * FONT_TOLERANCE) return false;
  return spans.every((span, index) => {
    const band = tail.bands[index];
    const fits = band !== undefined && Math.min(span.x + span.width, band.right) > Math.max(span.x, band.left);
    return fits && (tail.numeric[index] !== true || !/\p{L}/u.test(span.text));
  });
}

/**
 * The rows at the top of `page` that continue `tail`, or undefined when the page
 * does not start with one. `candidates` are the page's candidates without furniture
 * and before column splitting, which would otherwise break a two-row fragment into
 * columns.
 */
export function takeTableContinuation(
  tail: TableTail,
  page: PageFrame,
  candidates: readonly Candidate[],
): TableContinuation | undefined {
  if (Math.abs(page.width - tail.page.width) > Math.max(page.width, tail.page.width) * WIDTH_TOLERANCE) return undefined;
  const lines = candidates
    .filter((candidate) => candidate.lines.some((line) => line.spans.length > 0))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const body = lines.slice(leadingBandLines(lines.map((candidate) => candidate.box), page.height));
  if (body[0] === undefined || !meetsAtPageBreak(tail.page, tail.box, page, body[0].box)) return undefined;
  const header = repeatedHeaderLength(tail.table, body);
  const rows: Candidate[] = [];
  for (const candidate of body.slice(header)) {
    const above = rows[rows.length - 1];
    const sparse = above !== undefined && (candidate.lines[0]?.spans.length ?? 0) < tail.bands.length;
    if (sparse ? !fitsBands(candidate, tail.bands) : !continuesRow(tail, candidate)) break;
    if (above !== undefined && !nextRowWithin(above.box, candidate.box, tail.pitch)) break;
    rows.push(candidate);
  }
  const grid = rows.length === 0 ? undefined : inferTableGrid(rows.flatMap((candidate) => candidate.lines), tail.bands);
  return grid === undefined ? undefined : { consumed: body.slice(0, header + rows.length), rows, grid };
}

/** Whether `next`, the first body element of `page`, continues `previous`, which ends at `end` on the page before. */
export function continuesParagraph(
  previous: ParagraphElement,
  end: { readonly page: PageFrame; readonly box: LayoutBox },
  next: { readonly kind: string; readonly text?: string; readonly provenance: ElementProvenance },
  page: PageFrame,
): next is ParagraphElement {
  const text = previous.text.trimEnd();
  return next.kind === "paragraph" && text !== "" && !FINISHED.test(text) &&
    /^\p{Ll}/u.test(next.text?.trimStart() ?? "") &&
    meetsAtPageBreak(end.page, end.box, page, next.provenance.box);
}

export function appendParagraph(base: ParagraphElement, next: { readonly text: string; readonly runs: ParagraphElement["runs"]; readonly provenance: ElementProvenance }): ParagraphElement {
  return {
    ...base,
    text: `${base.text}\n${next.text}`,
    runs: [...base.runs, { text: "\n" }, ...next.runs],
    provenance: withContinuation(base.provenance, next.provenance),
  };
}
