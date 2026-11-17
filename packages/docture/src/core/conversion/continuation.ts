import type { ConversionWarning, ElementProvenance, ParagraphElement, TableElement } from "../domain/conversion.js";
import type { LayoutBox, TextLine, TextSpan } from "../domain/geometry.js";
import { fontSizes, HEADING_SIZE_RATIO, isTableCandidate, median, type Candidate } from "./candidates.js";
import { bandOf } from "./furniture.js";
import { withContinuation } from "./provenance.js";
import {
  bareContinuation,
  cellsOnBands,
  continuedTableLabel,
  inferTableGrid,
  isTitleLabel,
  nextRowWithin,
  mergedRow,
  opensSection,
  placesOnBands,
  rowStep,
  sameRow,
  type ColumnBand,
  type TableGrid,
  type TableGroup,
} from "./table-grid.js";

const PAGE_EDGE = 0.25;
const WIDTH_TOLERANCE = 0.02;
const FONT_TOLERANCE = 0.1;
const MAX_CELL_LENGTH = 40;
const FINISHED = /[.!?:;]["'”’»)\]}]*$/u;
const PAGE_REFERENCE = String.raw`(?:\p{Nd}{1,4}|(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))`;
const LEADER = String.raw`(?:\.{3,}|(?:\.\s+){2,}\.|[…⋯]+|·{3,}|(?:·\s+){2,}·)`;
const LEADER_REFERENCE = new RegExp(String.raw`${LEADER}\s*${PAGE_REFERENCE}\s*$`, "iu");
const ONLY_REFERENCE = new RegExp(String.raw`^\s*${PAGE_REFERENCE}\s*$`, "iu");
const REFERENCE_GAP = 2;

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
  readonly suspectBelow?: Candidate;
  readonly label?: string;
}

export interface TableContinuation {
  readonly kind: "join";
  /** The candidates taken from the page, a dropped repeated header included. */
  readonly consumed: readonly Candidate[];
  /** The candidates that become body rows, one line each. */
  readonly rows: readonly Candidate[];
  /** Indices of `rows` joined into the row above, as the lines of one wrapped row. */
  readonly joined?: readonly number[];
  /** Those rows on the table's columns, one grid row per row after joining. Its `headerRows` is meaningless here. */
  readonly grid: TableGrid;
}

export interface SeparateTables {
  readonly kind: "separate";
  readonly warning: ConversionWarning;
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
  const joined = new Set(group.joined ?? []);
  const rows = lines.reduce<TextLine[][]>((all, line, index) => {
    if (joined.has(index)) all.at(-1)?.push(line);
    else all.push([line]);
    return all;
  }, []);
  // The pitch comes from the body rows too, since a header set apart from them would stretch it.
  const bodyRows = rows.slice(group.headerRows);
  const body = bodyRows.length > 0 ? bodyRows.flat() : lines;
  const spans = body.flatMap((line) => line.spans);
  const full = body.filter((line) => line.spans.length === bands.length);
  return {
    bands,
    fontSize: median(spans.flatMap((span) => span.style?.fontSize ?? [])),
    bold: isBold(spans),
    pitch: rowStep(bodyRows.length >= 2 ? bodyRows : rows),
    numeric: bands.map((_band, col) => {
      const cells = full.map((line) => line.spans[col]?.text.trim() ?? "").filter((text) => text !== "");
      return cells.length > 0 && cells.every(numberLike);
    }),
  };
}

function cellTexts(candidate: Candidate): string[] {
  return (candidate.lines[0]?.spans ?? []).map((span) => span.text.trim()).filter((text) => text !== "");
}

/**
 * How many of the first `body` lines repeat the table's header rows: one line per row, or
 * two lines that give a row's labels column by column, as a header set on two lines does.
 */
function repeatedHeaderLength(table: TableElement, body: readonly Candidate[], bands: readonly ColumnBand[]): number {
  const header = table.rows.slice(0, table.headerRows).map((row) => row.filter((cell) => cell !== ""));
  const same = (texts: readonly string[], labels: readonly string[]): boolean =>
    texts.length === labels.length && texts.every((text, col) => text === labels[col]);
  let used = 0;
  for (const labels of header) {
    const one = body[used];
    if (one !== undefined && one.lines.length === 1 && same(cellTexts(one), labels)) {
      used += 1;
      continue;
    }
    const two = body.slice(used, used + 2);
    const merged = two.length === 2 && two.every((candidate) => candidate.lines.length === 1)
      ? mergedRow(two.flatMap((candidate) => candidate.lines), bands)
      : undefined;
    if (merged === undefined || !same(merged.spans.map((span) => span.text.trim()).filter((text) => text !== ""), labels)) return 0;
    used += 2;
  }
  return used;
}

/** Whether `candidate` is set in the weight and size of the table's body rows. */
function setLikeRows(tail: TableTail, candidate: Candidate): boolean {
  const spans = candidate.lines.flatMap((line) => line.spans);
  const size = median(fontSizes(candidate));
  return isBold(spans) === tail.bold && (tail.fontSize <= 0 || Math.abs(size - tail.fontSize) <= tail.fontSize * FONT_TOLERANCE);
}

/** Whether `candidate` is a full row of the table. Only the `first` row on the page must also keep its cells short. */
function continuesRow(tail: TableTail, candidate: Candidate, first: boolean): boolean {
  const spans = candidate.lines[0]?.spans ?? [];
  if (candidate.lines.length !== 1 || !isTableCandidate(candidate) || spans.length !== tail.bands.length) return false;
  if ((first && spans.some((span) => span.text.trim().length > MAX_CELL_LENGTH)) || !setLikeRows(tail, candidate)) return false;
  return spans.every((span, index) => {
    const band = tail.bands[index];
    const fits = band !== undefined && Math.min(span.x + span.width, band.right) > Math.max(span.x, band.left);
    return fits && (tail.numeric[index] !== true || !/\p{L}/u.test(span.text));
  });
}

function textOfCandidate(candidate: Candidate): string {
  return candidate.lines.map((line) => line.text).join(" ").trim();
}

function continuesLabel(candidate: Candidate, label: string | undefined): boolean {
  const text = textOfCandidate(candidate);
  return bareContinuation(text) || (label !== undefined && continuedTableLabel(text) === label);
}

/**
 * Whether `candidate` continues a table numbered differently from the one ending above.
 * Only two `Table N` numbers conflict: a title above a table may be a note or an account
 * line rather than its caption, and a continuation may shorten the title.
 */
function continuesOtherTable(candidate: Candidate, label: string | undefined): boolean {
  const named = continuedTableLabel(textOfCandidate(candidate));
  return label !== undefined && named !== undefined && named !== label && !isTitleLabel(label) && !isTitleLabel(named);
}

function startsSection(tail: TableTail, candidate: Candidate): boolean {
  const spans = candidate.lines.flatMap((line) => line.spans);
  const size = median(fontSizes(candidate));
  return candidate.role === "heading" || (isBold(spans) && !tail.bold) ||
    (tail.fontSize > 0 && size >= tail.fontSize * HEADING_SIZE_RATIO);
}

const lineOf = (candidate: Candidate): string => candidate.lineIds[0] ?? candidate.id;

function keptSeparate(tail: TableTail, page: PageFrame, first: Candidate, reason: string): SeparateTables {
  const end = tail.table.rowProvenance?.at(-1)?.lineIds?.at(-1) ?? tail.table.id;
  return {
    kind: "separate",
    warning: {
      code: "LAYOUT_DEGRADED",
      message: `Kept the table ending at ${end} separate from ${lineOf(first)} on page ${page.pageNumber}: ${reason}.`,
      pageNumber: page.pageNumber,
    },
  };
}

function suspectReason(suspect: Candidate, pages: readonly number[], pageHeight: number): string {
  const text = textOfCandidate(suspect);
  const running = bandOf(suspect.box, pageHeight) === "page-footer" ? "footer" : "header";
  return `"${text}" (${lineOf(suspect)}) repeats at the same place on page${pages.length > 1 ? "s" : ""} ${pages.join(", ")} and may be a running ${running}`;
}

export function takeTableContinuation(
  tail: TableTail,
  page: PageFrame,
  candidates: readonly Candidate[],
  suspected: ReadonlyMap<Candidate, readonly number[]>,
): TableContinuation | SeparateTables | undefined {
  if (Math.abs(page.width - tail.page.width) > Math.max(page.width, tail.page.width) * WIDTH_TOLERANCE) return undefined;
  const lines = candidates
    .filter((candidate) => candidate.lines.some((line) => line.spans.length > 0))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const banded = lines.slice(0, leadingBandLines(lines.map((candidate) => candidate.box), page.height));
  const headerRows = tail.table.headerRows;
  const bandHeader = headerRows > 0 && repeatedHeaderLength(tail.table, banded.slice(-headerRows), tail.bands) > 0 ? headerRows : 0;
  const skipped = banded.slice(0, banded.length - bandHeader);
  const top = lines.slice(skipped.length);
  // Lines above a continuation line for this table near the top of the page are running
  // lines the furniture pass missed, such as `Page 2 of 6`. A repeated header alone is not
  // enough, since a new section can open with the same columns under its own title.
  const anchor = top.findIndex((candidate) => candidate.box.y <= page.height * PAGE_EDGE && continuesLabel(candidate, tail.label));
  const running = top.slice(0, Math.max(0, anchor));
  const body = top.slice(running.length);
  if (body[0] === undefined || !meetsAtPageBreak(tail.page, tail.box, page, body[0].box)) return undefined;
  // A continuation line naming the table below them shows the top lines are the page's own, such as a letterhead.
  const named = body[0] !== undefined && continuesLabel(body[0], tail.label);
  if (!named && skipped.some((candidate) => !continuesLabel(candidate, tail.label) && startsSection(tail, candidate))) return undefined;
  if ([...skipped, ...running, body[0]].some((candidate) => continuesOtherTable(candidate, tail.label))) return undefined;
  const bandMarkers = skipped.filter((candidate) => continuesLabel(candidate, tail.label));
  const marker = continuesLabel(body[0], tail.label) ? 1 : 0;
  const marked = bandMarkers.length > 0 || marker === 1;
  const repeated = repeatedHeaderLength(tail.table, body.slice(marker), tail.bands);
  const header = marker + repeated;
  const rows: Candidate[] = [];
  const joined: number[] = [];
  // Judged cell by cell on the table's columns: OCR reads words, and a date can sit closer to its description than an em.
  const original = new Map<Candidate, Candidate>();
  const candidatesAfter = body.slice(header).map((candidate) => {
    const line = candidate.lines.length === 1 ? candidate.lines[0] : undefined;
    const cells = line === undefined ? undefined : cellsOnBands(line, tail.bands);
    if (cells === undefined) return candidate;
    const onBands = { ...candidate, lines: [cells] };
    original.set(onBands, candidate);
    return onBands;
  });
  const fillsBands = (candidate: Candidate): boolean => (candidate.lines[0]?.spans.length ?? 0) >= tail.bands.length;
  const tightBelow = (above: Candidate | undefined, below: Candidate | undefined): boolean =>
    above !== undefined && below !== undefined && sameRow(above.box, below.box, tail.pitch);
  for (const [index, candidate] of candidatesAfter.entries()) {
    const above = rows[rows.length - 1];
    const line = candidate.lines[0];
    const row = rows.slice(rows.length - 1 - trailingJoined(joined, rows.length - 1));
    // A line that fills every column is a row of its own under a row that fills them too.
    const tight = tightBelow(above, candidate) && !(fillsBands(candidate) && row.some(fillsBands)) &&
      mergedRow([...row, candidate].flatMap((member) => member.lines), tail.bands) !== undefined;
    // A confirmed header lets the first row leave columns empty, as a debit row leaves the credits.
    const sparse = (above !== undefined || header > 0) && (line?.spans.length ?? 0) < tail.bands.length;
    // One cell of a row whose other cells sit on the line below or above it, closer than a row step.
    // A one-cell first line of the page leads such a row only under a repeated header or a
    // continuation line, since a note or another table's title can sit as close above the rows.
    const partial = candidate.lines.length === 1 && line !== undefined && placesOnBands(line, tail.bands) && setLikeRows(tail, candidate) &&
      (tight || ((above !== undefined || header > 0 || marked || line.spans.length >= 2) && tightBelow(candidate, candidatesAfter[index + 1])));
    const fits = line !== undefined && line.spans.length >= 2 && placesOnBands(line, tail.bands);
    if (!partial && (sparse ? !fits : !continuesRow(tail, candidate, above === undefined))) break;
    if (above !== undefined && !nextRowWithin(above.box, candidate.box, tail.pitch)) break;
    if (!tight && above !== undefined && line !== undefined &&
      opensSection(line, above.lines.at(-1), candidate.box.y - above.box.y, tail.pitch, tail.bands, tail.numeric.at(-1) === true)) break;
    if (tight) joined.push(rows.length);
    rows.push(candidate);
  }
  // As in the table itself, a tight line under the last row's fullest line stays out of it,
  // and so does a last row of a single cell.
  const lastStart = rows.length - 1 - trailingJoined(joined, rows.length - 1);
  const cellCounts = rows.slice(lastStart).map((candidate) => candidate.lines[0]?.spans.length ?? 0);
  const fullest = lastStart + cellCounts.indexOf(Math.max(...cellCounts));
  while (rows.length > 0 && (rows.length > fullest + 1 || (rows.at(-1)?.lines[0]?.spans.length ?? 0) === 1)) {
    if (joined.at(-1) === rows.length - 1) joined.pop();
    rows.pop();
  }
  const groups: TextLine[][] = [];
  rows.forEach((candidate, index) => {
    const row = groups.at(-1);
    if (row !== undefined && joined.includes(index)) row.push(...candidate.lines);
    else groups.push([...candidate.lines]);
  });
  const merged = groups.map((lines) => mergedRow(lines, tail.bands));
  if (merged.some((line) => line === undefined)) return undefined;
  const grid = merged.length === 0 ? undefined : inferTableGrid(merged as TextLine[], tail.bands);
  const first = rows[0];
  if (grid === undefined || first === undefined) return undefined;
  const crossed = tail.suspectBelow ?? [...skipped, ...rows.map((row) => original.get(row) ?? row)].find((candidate) => suspected.has(candidate));
  if (crossed !== undefined) {
    const height = crossed === tail.suspectBelow ? tail.page.height : page.height;
    return keptSeparate(tail, page, first, suspectReason(crossed, suspected.get(crossed) ?? [], height));
  }
  if (repeated === 0 && !marked && !tail.numeric.some(Boolean)) {
    return keptSeparate(tail, page, first, "its rows hold only text, and the page repeats neither the table's header nor a continuation line for its caption");
  }
  return {
    kind: "join", consumed: [...bandMarkers, ...body.slice(0, header + rows.length)], rows, grid,
    ...(joined.length === 0 ? {} : { joined }),
  };
}

function isPageReferenceLine(text: string, line?: Pick<TextLine, "height" | "spans">): boolean {
  if (LEADER_REFERENCE.test(text)) return true;
  if (line === undefined) return false;
  const last = line.spans[line.spans.length - 1];
  const before = line.spans[line.spans.length - 2];
  return last !== undefined && before !== undefined && ONLY_REFERENCE.test(last.text) &&
    last.x - (before.x + before.width) >= line.height * REFERENCE_GAP;
}

export interface ParagraphBreakLines {
  readonly end: TextLine | undefined;
  readonly start: TextLine | undefined;
}

/** Whether `next`, the first body element of `page`, continues `previous`, which ends at `end` on the page before. */
export function continuesParagraph(
  previous: ParagraphElement,
  end: { readonly page: PageFrame; readonly box: LayoutBox },
  next: { readonly kind: string; readonly text?: string; readonly provenance: ElementProvenance },
  page: PageFrame,
  lines: ParagraphBreakLines,
): next is ParagraphElement {
  const text = previous.text.trimEnd();
  const start = next.text?.trimStart() ?? "";
  return next.kind === "paragraph" && text !== "" && !FINISHED.test(text) &&
    /^\p{Ll}/u.test(start) &&
    meetsAtPageBreak(end.page, end.box, page, next.provenance.box) &&
    !isPageReferenceLine(text.slice(text.lastIndexOf("\n") + 1), lines.end) &&
    !isPageReferenceLine(start.split("\n", 1)[0] ?? "", lines.start);
}

export function appendParagraph(base: ParagraphElement, next: { readonly text: string; readonly runs: ParagraphElement["runs"]; readonly provenance: ElementProvenance }): ParagraphElement {
  return {
    ...base,
    text: `${base.text}\n${next.text}`,
    runs: [...base.runs, { text: "\n" }, ...next.runs],
    provenance: withContinuation(base.provenance, next.provenance),
  };
}

/** How many rows directly above `index`, counting it, were joined into the row above them. */
function trailingJoined(joined: readonly number[], index: number): number {
  let count = 0;
  while (index - count >= 0 && joined.includes(index - count)) count += 1;
  return count;
}
