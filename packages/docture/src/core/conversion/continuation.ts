import type { ConversionWarning, ElementProvenance, ParagraphElement, TableElement } from "../domain/conversion.js";
import type { LayoutBox, TextLine, TextSpan } from "../domain/geometry.js";
import { fontSizes, HEADING_SIZE_RATIO, isTableCandidate, median, type Candidate } from "./candidates.js";
import { bandOf } from "./furniture.js";
import { withContinuation } from "./provenance.js";
import {
  continuedTableLabel,
  fitsBands,
  inferTableGrid,
  nextRowWithin,
  opensSection,
  rowPitch,
  tableLabel,
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
  /** Those rows on the table's columns. Its `headerRows` is meaningless here. */
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

function textOfCandidate(candidate: Candidate): string {
  return candidate.lines.map((line) => line.text).join(" ").trim();
}

function continuesLabel(candidate: Candidate, label: string | undefined): boolean {
  return label !== undefined && continuedTableLabel(textOfCandidate(candidate)) === label;
}

function continuesOtherTable(candidate: Candidate, label: string | undefined): boolean {
  const named = continuedTableLabel(textOfCandidate(candidate));
  return label !== undefined && named !== undefined && named !== label;
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
  const bandHeader = headerRows > 0 && repeatedHeaderLength(tail.table, banded.slice(-headerRows)) > 0 ? headerRows : 0;
  const skipped = banded.slice(0, banded.length - bandHeader);
  const body = lines.slice(skipped.length);
  if (body[0] === undefined || !meetsAtPageBreak(tail.page, tail.box, page, body[0].box)) return undefined;
  if (skipped.some((candidate) => !continuesLabel(candidate, tail.label) && startsSection(tail, candidate))) return undefined;
  if ([...skipped, body[0]].some((candidate) => continuesOtherTable(candidate, tail.label))) return undefined;
  const bandMarkers = skipped.filter((candidate) => continuesLabel(candidate, tail.label));
  const marker = continuesLabel(body[0], tail.label) ? 1 : 0;
  const marked = bandMarkers.length > 0 || marker === 1;
  const repeated = repeatedHeaderLength(tail.table, body.slice(marker));
  const header = marker + repeated;
  const rows: Candidate[] = [];
  for (const candidate of body.slice(header)) {
    const above = rows[rows.length - 1];
    const sparse = above !== undefined && (candidate.lines[0]?.spans.length ?? 0) < tail.bands.length;
    if (sparse ? !fitsBands(candidate, tail.bands) : !continuesRow(tail, candidate)) break;
    if (above !== undefined && !nextRowWithin(above.box, candidate.box, tail.pitch)) break;
    const line = candidate.lines[0];
    if (above !== undefined && line !== undefined &&
      opensSection(line, above.lines.at(-1), candidate.box.y - above.box.y, tail.pitch, tail.bands, tail.numeric.at(-1) === true)) break;
    rows.push(candidate);
  }
  const grid = rows.length === 0 ? undefined : inferTableGrid(rows.flatMap((candidate) => candidate.lines), tail.bands);
  const first = rows[0];
  if (grid === undefined || first === undefined) return undefined;
  const crossed = tail.suspectBelow ?? [...skipped, ...rows].find((candidate) => suspected.has(candidate));
  if (crossed !== undefined) {
    const height = crossed === tail.suspectBelow ? tail.page.height : page.height;
    return keptSeparate(tail, page, first, suspectReason(crossed, suspected.get(crossed) ?? [], height));
  }
  if (repeated === 0 && !marked && !tail.numeric.some(Boolean)) {
    return keptSeparate(tail, page, first, "its rows hold only text, and the page repeats neither the table's header nor a continuation line for its caption");
  }
  return { kind: "join", consumed: [...bandMarkers, ...body.slice(0, header + rows.length)], rows, grid };
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
