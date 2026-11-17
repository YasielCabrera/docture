import type { TableCellSpan } from "../domain/conversion.js";
import type { LayoutBox, TextLine, TextSpan } from "../domain/geometry.js";
import { spanSeparator } from "../domain/lines.js";
import { boxOfLines, characterFontSize, compatibleTableRows, HEADING_SIZE_RATIO, isTableCandidate, median, tableEm, type Candidate } from "./candidates.js";

const MAX_ROW_STEP = 3;
const SECTION_STEP = 1.5;
const CENTER_TOLERANCE = 0.1;
const CAPTION = /^\s*(?:table|figure|fig\.|chart|exhibit)\s+(?:[\p{N}ivxlc]|\p{L}(?!\p{L}))/iu;
const TABLE_LABEL = /^\s*table\s+([\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*)/iu;
const CONTINUED = /\b(?:continued|cont(?:['’]d|\.))/iu;

export function tableLabel(caption: string): string | undefined {
  return TABLE_LABEL.exec(caption)?.[1]?.toLowerCase();
}

// English marks may stand bare at the end of a title. Marks in other languages must sit in
// brackets or follow a dash, since a word such as `suite` also ends ordinary titles.
const ENGLISH_MARK = String.raw`(?<![\p{L}\p{N}])(?:continued|cont(?:['’]d\.?|\.))(?:\s+(?:from|on)\b[^)\]）］]*)?`;
const OTHER_MARK = String.raw`(?:fortsetzung|forts\.|suite|continuaci[oó]n|continua[çc][ãa]o|continuazione|segue|продолжение|続き|続|续|續|계속|تابع|تتمة)`;
const CONTINUED_MARK = new RegExp(
  String.raw`[\s,;:]*(?:[(\[（［]\s*(?:${ENGLISH_MARK}|${OTHER_MARK})\s*[)\]）］]|[-–—]?\s*${ENGLISH_MARK}|[-–—]\s*${OTHER_MARK})\s*$`,
  "iu",
);
/** A line that is only a continuation mark, such as `Continued`, `(Fortsetzung)` or `Продолжение`. */
const BARE_MARK = new RegExp(String.raw`^\s*[(\[（［]?\s*(?:${ENGLISH_MARK}|${OTHER_MARK})\s*[)\]）］]?\s*[.:]?\s*$`, "iu");
const MAX_TITLE_LABEL = 60;
const TITLE_PREFIX = "title:";

/** Whether `text` only marks a continuation, naming no table, as a bare `Continued` line at the top of a page does. */
export function bareContinuation(text: string): boolean {
  return BARE_MARK.test(text);
}

/** A table's label: the number of its `Table N` caption, or else the short title line above it, such as `TRANSACTIONS`. */
export function captionLabel(caption: string): string | undefined {
  const number = tableLabel(caption);
  if (number !== undefined) return number;
  if (caption.includes("\n")) return undefined;
  const title = caption.replace(CONTINUED_MARK, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return title.length > 0 && title.length <= MAX_TITLE_LABEL && /\p{L}/u.test(title) ? `${TITLE_PREFIX}${title}` : undefined;
}

/** The `Table N` number a continuation line such as `Table 3 (continued)` names, if `text` is one. */
export function continuedTableNumber(text: string): string | undefined {
  return CONTINUED.test(text) ? tableLabel(text) : undefined;
}

/** Whether `label` comes from a title rather than a `Table N` number. */
export const isTitleLabel = (label: string): boolean => label.startsWith(TITLE_PREFIX);

/** The table a continuation line such as `Table N (continued)` or `TRANSACTIONS (continued)` names, if `text` is one. */
export function continuedTableLabel(text: string): string | undefined {
  const number = continuedTableNumber(text);
  if (number !== undefined) return number;
  return CONTINUED_MARK.test(text) ? captionLabel(text.replace(CONTINUED_MARK, "")) : undefined;
}

/** The median step between the tops of consecutive `boxes`, top-down; 0 below two boxes. */
function rowPitch(boxes: readonly LayoutBox[]): number {
  return median(boxes.slice(1).map((box, index) => box.y - (boxes[index]?.y ?? box.y)));
}

/**
 * The median step from the lowest line of each row to the top of the next, top-down;
 * 0 below two rows. Unlike the step between row tops, a row's wrapped lines do not stretch it.
 */
export function rowStep(rows: readonly (readonly { readonly y: number }[])[]): number {
  return median(rows.slice(1).flatMap((row, index) => {
    const above = rows[index] ?? [];
    return row.length === 0 || above.length === 0 ? [] : [Math.min(...row.map((line) => line.y)) - Math.max(...above.map((line) => line.y))];
  }));
}

/**
 * Whether `below` starts close enough under `above` to be the next row of a table
 * whose rows are `pitch` apart. Without a pitch (a single row so far) any distance passes.
 */
export function nextRowWithin(above: LayoutBox, below: LayoutBox, pitch: number): boolean {
  return pitch <= 0 || below.y - above.y <= pitch * MAX_ROW_STEP;
}

const isBold = (line: TextLine): boolean => line.spans.length > 0 && line.spans.every((span) => span.style?.bold === true);

export function opensSection(
  line: TextLine,
  previous: TextLine | undefined,
  step: number,
  pitch: number,
  bands: readonly ColumnBand[],
  terminalNumeric: boolean,
): boolean {
  if (pitch <= 0 || step <= pitch * SECTION_STEP) return false;
  const last = line.spans[line.spans.length - 1];
  const placement = placeCells(line.spans, bands)?.at(-1);
  if (terminalNumeric && last !== undefined && placement?.last === bands.length - 1 && /\p{N}/u.test(last.text) && !/\p{L}/u.test(last.text)) return false;
  return (previous !== undefined && isBold(line) !== isBold(previous)) || line.spans.length < bands.length;
}

function rowsWithinPitch(rows: readonly Candidate[]): number {
  const steps: number[] = [];
  const insert = (step: number): void => {
    let low = 0;
    let high = steps.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((steps[middle] ?? 0) < step) low = middle + 1;
      else high = middle;
    }
    steps.splice(low, 0, step);
  };
  const pitch = (): number => {
    const middle = steps.length >> 1;
    return steps.length % 2 === 1 ? steps[middle] ?? 0 : ((steps[middle - 1] ?? 0) + (steps[middle] ?? 0)) / 2;
  };
  for (let count = 2; count < rows.length; count += 1) {
    const above = rows[count - 1];
    const below = rows[count];
    const previous = rows[count - 2];
    if (above !== undefined && previous !== undefined) insert(above.box.y - previous.box.y);
    if (above === undefined || below === undefined || below.role === "table") continue;
    if (!nextRowWithin(above.box, below.box, pitch())) return count;
  }
  return rows.length;
}

/** The horizontal extent of one column's cells. */
export interface ColumnBand {
  readonly left: number;
  readonly right: number;
}

export interface TableGrid {
  readonly rows: readonly (readonly string[])[];
  readonly headerRows: number;
  readonly spans?: readonly TableCellSpan[];
}

export interface TableGroup extends TableGrid {
  readonly rule: "equal-width" | "bands";
  readonly candidates: readonly Candidate[];
  /** One band per column. Absent when the columns of an equal-width group overlap. */
  readonly bands?: readonly ColumnBand[];
  /** Indices of group lines joined into the row above. */
  readonly joined?: readonly number[];
}

interface Placement {
  readonly first: number;
  readonly last: number;
}

function columnBands(rows: readonly TextLine[]): readonly ColumnBand[] | undefined {
  const width = rows[0]?.spans.length ?? 0;
  if (width < 2 || rows.some((row) => row.spans.length !== width)) return undefined;
  const bands = Array.from({ length: width }, (_unused, col) => {
    const cells = rows.flatMap((row) => row.spans.slice(col, col + 1));
    return {
      left: Math.min(...cells.map((cell) => cell.x)),
      right: Math.max(...cells.map((cell) => cell.x + cell.width)),
    };
  });
  const separated = bands.every((band, index) =>
    band.right > band.left && (index === 0 || band.left > (bands[index - 1]?.right ?? 0)));
  return separated ? bands : undefined;
}

function overlap(span: TextSpan, band: ColumnBand): number {
  return Math.max(0, Math.min(span.x + span.width, band.right) - Math.max(span.x, band.left));
}

function placeCells(spans: readonly TextSpan[], bands: readonly ColumnBand[]): Placement[] | undefined {
  const overlaps = spans.map((span) => bands.map((band) => overlap(span, band)));
  // How many spans touch each band, so a span can tell at once whether it has a band to itself.
  const touching = bands.map((_band, col) => overlaps.filter((row) => (row[col] ?? 0) > 0).length);
  const placements: Placement[] = [];
  for (const row of overlaps) {
    const best = row.reduce((found, value, col) => (value > (row[found] ?? 0) ? col : found), 0);
    if ((row[best] ?? 0) <= 0) return undefined;
    const covered = bands.flatMap((band, col) =>
      (row[col] ?? 0) > (band.right - band.left) / 2 && (touching[col] ?? 0) === 1
        ? [col]
        : []);
    const first = covered[0];
    const last = covered[covered.length - 1];
    placements.push(covered.length >= 2 && first !== undefined && last !== undefined
      ? { first, last }
      : { first: best, last: best });
  }
  const ordered = placements.every((placement, index) =>
    index === 0 || placement.first > (placements[index - 1]?.last ?? Number.POSITIVE_INFINITY));
  return ordered ? placements : undefined;
}

function centeredRun(span: TextSpan, bands: readonly ColumnBand[]): Placement | undefined {
  const center = span.x + span.width / 2;
  for (let size = 2; size <= bands.length; size += 1) {
    for (let first = 0; first + size <= bands.length; first += 1) {
      const left = bands[first]?.left ?? 0;
      const right = bands[first + size - 1]?.right ?? 0;
      if (span.x >= left && span.x + span.width <= right && Math.abs(center - (left + right) / 2) <= (right - left) * CENTER_TOLERANCE) {
        return { first, last: first + size - 1 };
      }
    }
  }
  return undefined;
}

const lineSize = (line: TextLine): number => median(line.spans.flatMap((span) => span.style?.fontSize ?? []));

function placedAsGroupLabel(lines: readonly TextLine[]): boolean {
  const [label, child] = lines;
  if (label === undefined || child === undefined || lines.length < 3) return false;
  const pitch = rowPitch(lines.slice(1).map((line) => boxOfLines([line])));
  const size = lineSize(label);
  const body = median(lines.slice(1).map(lineSize));
  return pitch > 0 && child.y - label.y <= pitch * SECTION_STEP && !CAPTION.test(label.text) &&
    !(size > 0 && body > 0 && size >= body * HEADING_SIZE_RATIO);
}

const boldHeader = (lines: readonly TextLine[]): boolean =>
  lines[0] !== undefined && isBold(lines[0]) && lines.slice(1).some((line) => !isBold(line));

function centeredHeader(lines: readonly TextLine[], bands: readonly ColumnBand[]): Placement[] | undefined {
  const label = lines[0];
  if (label === undefined || !boldHeader(lines) || !placedAsGroupLabel(lines)) return undefined;
  const runs = label.spans.map((span) => centeredRun(span, bands));
  if (runs.every((run) => run === undefined)) return undefined;
  const placements = runs.map((run, index) => {
    const span = label.spans[index];
    if (run !== undefined || span === undefined) return run;
    const overlaps = bands.map((band) => overlap(span, band));
    const best = overlaps.indexOf(Math.max(...overlaps));
    return (overlaps[best] ?? 0) > 0 ? { first: best, last: best } : undefined;
  });
  const ordered = placements.every((placement, index) =>
    placement !== undefined && (index === 0 || placement.first > (placements[index - 1]?.last ?? Number.POSITIVE_INFINITY)));
  return ordered ? placements as Placement[] : undefined;
}

export function unresolvedGroupLabel(label: TextLine, rows: readonly TextLine[], bands: readonly ColumnBand[]): number | undefined {
  const lines = [label, ...rows];
  const span = label.spans[0];
  const run = span === undefined || label.spans.length !== 1 ? undefined : centeredRun(span, bands);
  return run === undefined || !placedAsGroupLabel(lines) || boldHeader(lines) ? undefined : run.last - run.first + 1;
}

function coversLine(span: TextSpan, line: TextLine): boolean {
  const box = boxOfLines([line]);
  const shared = Math.min(span.y + span.height, box.y + box.height) - Math.max(span.y, box.y);
  return box.height > 0 && shared >= box.height / 2;
}

/** A vertical table rule that OCR read as a character, beside a number. */
const LEADING_RULE = /^[|[\]「」]\s*(?=[-+(\p{Sc}\d])/u;
const TRAILING_RULE = /(?<=[\d%)])\s*[|[\]「」]$/u;

/**
 * A cell's text without a rule glyph that OCR read at its edge, as in `[150`,
 * `|07/15/2015` or `2/11 「`. The glyph goes only when it leaves a lone figure with no
 * other bracket, so `[1]`, `a | b`, `[0, 10)` and `「100」` stay as they are.
 */
function cellText(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.match(/[|[\]「」]/gu)?.length ?? 0) !== 1) return trimmed;
  const rest = trimmed.replace(LEADING_RULE, "").replace(TRAILING_RULE, "");
  const opened = rest.match(/\(/gu)?.length ?? 0;
  const closed = rest.match(/\)/gu)?.length ?? 0;
  return /\p{L}/u.test(rest) || opened !== closed ? trimmed : rest;
}

interface Anchor {
  readonly row: number;
  readonly col: number;
  readonly colSpan: number;
  readonly span: TextSpan;
  rowSpan: number;
}

/** Place every row's cells on `bands`. Undefined when a row does not fit them. */
export function inferTableGrid(lines: readonly TextLine[], bands: readonly ColumnBand[]): TableGrid | undefined {
  const placed: Placement[][] = [];
  for (const [index, line] of lines.entries()) {
    const centered = index === 0 ? centeredHeader(lines, bands) : undefined;
    const placement = centered ?? (index === 0 && line.spans.length === 1 ? undefined : placeCells(line.spans, bands));
    if (placement === undefined) return undefined;
    placed.push(placement);
  }
  const rows = lines.map(() => bands.map(() => ""));
  const anchors: Anchor[] = [];
  placed.forEach((cells, row) => cells.forEach((cell, index) => {
    const span = lines[row]?.spans[index];
    if (span === undefined) return;
    rows[row]![cell.first] = cellText(span.text);
    anchors.push({ row, col: cell.first, colSpan: cell.last - cell.first + 1, span, rowSpan: 1 });
  }));

  let headerRows = 1;
  while (headerRows < rows.length) {
    const spanned = anchors.filter((anchor) => anchor.row === headerRows - 1 && anchor.colSpan > 1);
    const under = (cell: Placement) => spanned.some((anchor) => cell.first >= anchor.col && cell.last < anchor.col + anchor.colSpan);
    const cells = placed[headerRows] ?? [];
    const labels = cells.every((cell) => under(cell) || rows[headerRows - 1]?.[cell.first] === "");
    if (!cells.some(under) || !labels) break;
    headerRows += 1;
  }

  const taken = rows.map((row) => row.map((cell) => cell !== ""));
  for (const anchor of anchors) {
    for (let col = anchor.col; col < anchor.col + anchor.colSpan; col += 1) taken[anchor.row]![col] = true;
  }
  for (const anchor of anchors) {
    const limit = anchor.row < headerRows ? headerRows : rows.length;
    const columns = Array.from({ length: anchor.colSpan }, (_unused, offset) => anchor.col + offset);
    for (let row = anchor.row + 1; row < limit; row += 1) {
      const line = lines[row];
      if (line === undefined || columns.some((col) => taken[row]?.[col] === true) || !coversLine(anchor.span, line)) break;
      for (const col of columns) taken[row]![col] = true;
      anchor.rowSpan += 1;
    }
  }
  const spans = anchors
    .filter((anchor) => anchor.rowSpan > 1 || anchor.colSpan > 1)
    .map(({ row, col, rowSpan, colSpan }) => ({ row, col, rowSpan, colSpan }));
  return { rows, headerRows, ...(spans.length === 0 ? {} : { spans }) };
}

const bandRows = new WeakMap<Candidate, TextLine | null>();

/** Whether the loader left the line's role open: no role, or the plain paragraph a tagged PDF gives every line. */
const untagged = (candidate: Candidate): boolean => candidate.role === undefined || candidate.role === "paragraph";

function bandRow(candidate: Candidate | undefined): TextLine | undefined {
  if (candidate === undefined) return undefined;
  const known = bandRows.get(candidate);
  if (known !== undefined) return known ?? undefined;
  const line = candidate.lines[0];
  let row: TextLine | null = null;
  if (line !== undefined && untagged(candidate) && candidate.lines.length === 1) {
    const gap = median(line.spans.map(tableEm).filter((height) => height > 0)) || 10;
    const separated = phrases.has(candidate) || line.spans.every((span, index) => {
      const next = line.spans[index + 1];
      return next === undefined || next.x - (span.x + span.width) >= gap;
    });
    if (separated && line.spans.length >= 2) row = line;
  }
  bandRows.set(candidate, row);
  return row ?? undefined;
}

const loneLabel = (candidate: Candidate | undefined): boolean =>
  candidate !== undefined && untagged(candidate) && candidate.lines.length === 1 && candidate.lines[0]?.spans.length === 1;

/** Whether every cell of `line` falls in its own band of `bands`, in order. */
export function placesOnBands(line: TextLine, bands: readonly ColumnBand[]): boolean {
  return placeCells(line.spans, bands) !== undefined;
}

// Wrapped text is closer than a normal row, with room before the next row.
const MAX_WRAP_STEP = 1.5;

/**
 * A line this much closer than the row pitch to the line above belongs to the same
 * row: a wrapped cell, a two-line header, or a row whose short cells sit centred
 * between the lines of a wrapped one.
 */
const SAME_ROW_STEP = 0.8;

/**
 * Whether `below` sits close enough under `above` to share its row in a table whose rows
 * are `pitch` apart. Measured between box centres, since OCR boxes of one row differ in height.
 */
export function sameRow(above: LayoutBox, below: LayoutBox, pitch: number): boolean {
  return pitch > 0 && !risesAbove(above, below) && below.y + below.height / 2 - (above.y + above.height / 2) < pitch * SAME_ROW_STEP;
}

/**
 * Whether `below` starts more than half a line above `above`: an earlier line that a
 * reading order placed later, such as a value line read after its column's labels. Table
 * rows run down the page.
 */
export function risesAbove(above: LayoutBox, below: LayoutBox): boolean {
  return below.y < above.y - below.height / 2;
}

const numberLike = (text: string): boolean => /\p{N}/u.test(text) && !/\p{L}/u.test(text);

/**
 * `bands` with a new band for each cell of `spans` that falls in no band, when the
 * rest of the row anchors it to the table: a column every earlier row left empty,
 * such as the debits of a statement whose first rows are all credits. Undefined when
 * the row needs no new band, too few of its cells sit on known bands, or a new band
 * would cut through a cell of `accepted`.
 */
function widenedBands(spans: readonly TextSpan[], bands: readonly ColumnBand[], accepted: readonly TextLine[]): ColumnBand[] | undefined {
  const loose = spans.filter((span) => grazes(span, bands));
  const anchored = spans.length - loose.length;
  if (loose.length === 0 || anchored < 2 || loose.length >= anchored) return undefined;
  const added = loose.map((span) => ({ left: span.x, right: span.x + span.width }));
  if (accepted.some((line) => line.spans.some((span) => added.some((band) => overlap(span, band) > 0)))) return undefined;
  // A column outside the table sits no farther from it than its columns sit apart; text
  // beyond that, such as the next page column read on the same OCR line, is not a cell.
  const widestGap = Math.max(0, ...bands.slice(1).map((band, index) => band.left - (bands[index]?.right ?? band.left)));
  const first = bands[0];
  const last = bands.at(-1);
  if (first === undefined || last === undefined || added.some((band) =>
    first.left - band.right > widestGap || band.left - last.right > widestGap)) return undefined;
  return [...bands, ...added].sort((a, b) => a.left - b.left);
}

/**
 * A cell that reaches less than this share of an em into a band only touches it, as a
 * year beside an indented label column does.
 */
const GRAZE = 0.25;

/** Whether `span` sits in no band, or only touches the one it overlaps most. */
function grazes(span: TextSpan, bands: readonly ColumnBand[]): boolean {
  return Math.max(0, ...bands.map((band) => overlap(span, band))) < Math.min(span.width, tableEm(span)) * GRAZE;
}

/**
 * `bands`, widened where a line needs a new column, when every one of `lines` fits them.
 * A line whose cell only touches a band gets its own column for that cell when one fits.
 */
function fittedBands(
  lines: readonly TextLine[], bands: readonly ColumnBand[], accepted: readonly TextLine[], widen: boolean,
): readonly ColumnBand[] | undefined {
  let next = bands;
  for (const line of lines) {
    const placed = placeCells(onBands(line, next).spans, next) !== undefined;
    if (placed && !line.spans.some((span) => grazes(span, next))) continue;
    const wider = widen ? widenedBands(line.spans, next, accepted) : undefined;
    if (wider !== undefined && placeCells(line.spans, wider) !== undefined) next = wider;
    else if (!placed) return undefined;
  }
  return next;
}

/**
 * A header cell's band: the one it overlaps, or else the nearest within an em, since a
 * label centred over right-aligned values can end beside them. -1 for a cell farther off.
 */
function headerPlacement(spans: readonly TextSpan[], bands: readonly ColumnBand[]): number[] | undefined {
  const cols = spans.map((span) => {
    const touching = bands.map((band) => overlap(span, band));
    const best = touching.indexOf(Math.max(...touching));
    if ((touching[best] ?? 0) > 0) return best;
    const distance = bands.map((band) => Math.max(band.left - (span.x + span.width), span.x - band.right));
    const nearest = distance.indexOf(Math.min(...distance));
    return (distance[nearest] ?? Number.POSITIVE_INFINITY) <= tableEm(span) ? nearest : -1;
  });
  return cols.every((col, index) => col >= 0 && (index === 0 || col > (cols[index - 1] ?? Number.POSITIVE_INFINITY))) ? cols : undefined;
}

/** `bands` with each band stretched over the header cell placed in it. */
function bandsUnderHeader(spans: readonly TextSpan[], cols: readonly number[], bands: readonly ColumnBand[]): ColumnBand[] {
  return bands.map((band, col) => {
    const cell = spans[cols.indexOf(col)];
    return cell === undefined ? band : { left: Math.min(band.left, cell.x), right: Math.max(band.right, cell.x + cell.width) };
  });
}

/**
 * The lines of one table row as a single line with one cell per band, top-down
 * within each cell. Undefined when a line does not fit the bands, a cell spans
 * several bands, or two lines put a number in the same column, which reads as two
 * rows rather than one wrapped row.
 */
export function mergedRow(rowLines: readonly TextLine[], bands: readonly ColumnBand[]): TextLine | undefined {
  const lines = rowLines.map((line) => onBands(line, bands));
  if (lines.length === 1) return lines[0];
  const cells = new Map<number, TextSpan[]>();
  for (const line of lines) {
    const placement = placeCells(line.spans, bands);
    if (placement === undefined) return undefined;
    for (const [index, cell] of placement.entries()) {
      const span = line.spans[index];
      if (span === undefined || cell.first !== cell.last) return undefined;
      const column = cells.get(cell.first) ?? [];
      if (column.some((other) => numberLike(other.text)) && numberLike(span.text)) return undefined;
      cells.set(cell.first, [...column, span]);
    }
  }
  const spans = [...cells.entries()].sort(([a], [b]) => a - b).map(([, column]): TextSpan => {
    const [head] = column;
    const box = boxOfLines([{ y: 0, height: 0, text: "", spans: column }]);
    return { ...head!, text: column.map((span) => span.text.trim()).join(" "), ...box };
  });
  const box = boxOfLines([{ y: 0, height: 0, text: "", spans }]);
  return { y: box.y, height: box.height, text: spans.map((span) => span.text).join(" "), spans };
}

/**
 * Rows of one table share a type size. A line this much larger or smaller, such as a
 * 9-point tax summary under 12-point line items, belongs to another table or to the text
 * around it. The tolerance leaves room for the sizes OCR estimates line by line.
 */
const SIZE_TOLERANCE = 1.25;

const sizeOf = (lines: readonly TextLine[]): number => characterFontSize(lines.flatMap((line) => line.spans));

function sameSize(size: number, tableSize: number): boolean {
  return size <= 0 || tableSize <= 0 || Math.max(size, tableSize) <= Math.min(size, tableSize) * SIZE_TOLERANCE;
}

/** A word right before the sentence's closing stop, unlike the dot leaders of `Santa Maria. . . 4. .`. */
const WORD_THEN_STOP = /\p{L}[.!?。！？]["'”’)）」』]*$/u;

/**
 * Whether a row of `lines` holds a run of prose across `bands`, as a footnote set under
 * the table does: words as wide as a prose cell that cover three or more columns, or two
 * and end a sentence. A short merged label, or a long description that runs into the next
 * column, is not one.
 */
function spansProse(lines: readonly TextLine[], bands: readonly ColumnBand[]): boolean {
  const merged = mergedRow(lines, bands);
  const placement = merged === undefined ? undefined : placeCells(merged.spans, bands);
  return placement?.some((cell, index) => {
    const span = merged?.spans[index];
    return span !== undefined && cell.last > cell.first && /\p{L}/u.test(span.text) && span.width >= PROSE_CELL_EMS * tableEm(span) &&
      (cell.last - cell.first >= 2 || (endsSentence(span.text.trim()) && WORD_THEN_STOP.test(span.text.trim())));
  }) ?? false;
}

/**
 * How many lines from `index` on follow each other closer than a row step, so read as one
 * row. A line with `width` cells or more is a row of its own after another such line.
 */
function rowLength(candidates: readonly Candidate[], index: number, pitch: number, width: number): number {
  const fills = (candidate: Candidate | undefined): boolean => (bandRow(candidate)?.spans.length ?? 0) >= width;
  let length = 1;
  for (;;) {
    const above = candidates[index + length - 1];
    const below = candidates[index + length];
    if (above === undefined || below === undefined || !sameRow(above.box, below.box, pitch)) return length;
    if (bandRow(below) === undefined && !loneLabel(below)) return length;
    if (fills(below) && candidates.slice(index, index + length).some(fills)) return length;
    length += 1;
  }
}

interface GrownRows {
  readonly rows: readonly (readonly number[])[];
  readonly bands: readonly ColumnBand[];
  readonly seedBands: readonly ColumnBand[];
  readonly width: number;
  readonly pitch: number;
}

/**
 * The rows a band table grows from `seed` down the page, and its bands. The table above a
 * seed does not change them, so the many starts that reach one seed share the result.
 */
const grownRowsBySeed = new WeakMap<readonly Candidate[], Map<number, GrownRows | null>>();

function grownRows(candidates: readonly Candidate[], seed: number): GrownRows | undefined {
  const known = grownRowsBySeed.get(candidates) ?? new Map<number, GrownRows | null>();
  grownRowsBySeed.set(candidates, known);
  const cached = known.get(seed);
  if (cached !== undefined) return cached ?? undefined;
  const grown = growRows(candidates, seed);
  known.set(seed, grown ?? null);
  return grown;
}

function growRows(candidates: readonly Candidate[], seed: number): GrownRows | undefined {
  const first = candidates[seed];
  const width = bandRow(first)?.spans.length ?? 0;
  if (first === undefined) return undefined;
  const matchesSeed = (candidate: Candidate | undefined): boolean =>
    candidate !== undefined && bandRow(candidate) !== undefined && compatibleTableRows(first, candidate);
  let end = seed + 1;
  while (matchesSeed(candidates[end])) end += 1;
  end = seed + rowsWithinPitch(candidates.slice(seed, end));
  const seedBands = columnBands(candidates.slice(seed, end).flatMap((candidate) => candidate.lines));
  if (seedBands === undefined) return undefined;
  let bands: readonly ColumnBand[] = seedBands;
  const lineAt = (index: number): TextLine | undefined =>
    bandRow(candidates[index]) ?? (loneLabel(candidates[index]) ? candidates[index]?.lines[0] : undefined);
  // Each row lists the candidates of its lines; a row of several lines is one wrapped row.
  const rows: number[][] = Array.from({ length: end - seed }, (_unused, offset) => [seed + offset]);
  const linesOf = (indices: readonly number[]): TextLine[] => indices.flatMap((index) => candidates[index]?.lines ?? []);
  // Kept as rows are added, so each line costs the same however long the group grows.
  const accepted = linesOf(rows.flat());
  const tableSize = sizeOf(accepted);
  const top = (row: readonly number[]): number => Math.min(...row.map((index) => candidates[index]?.box.y ?? 0));
  const bottom = (row: readonly number[]): number => Math.max(...row.map((index) => candidates[index]?.box.y ?? 0));
  // The steps between finished rows, sorted; the step into the last row can still change.
  const steps: number[] = [];
  rows.slice(1, -1).forEach((row, index) => insertSorted(steps, top(row) - bottom(rows[index] ?? row)));
  const rowPitchNow = (): number => {
    const last = rows.at(-1);
    const previous = rows.at(-2);
    return last === undefined || previous === undefined ? median(steps) : medianWith(steps, top(last) - bottom(previous));
  };
  const numericEnd = (value: TextLine): boolean => value.spans.length < width || /\p{N}/u.test(value.spans[width - 1]?.text ?? "");
  let sizedRows = rows.length;
  let bodyLines = linesOf(rows.slice(1).flat()).length;
  let bodyNumeric = linesOf(rows.slice(1).flat()).every(numericEnd);
  for (;;) {
    const line = lineAt(end);
    const above = candidates[end - 1];
    const below = candidates[end];
    const pitch = rowPitchNow();
    if (line === undefined || above === undefined || below === undefined) break;
    if (risesAbove(above.box, below.box) || !nextRowWithin(above.box, below.box, pitch)) break;
    // A line that fills every column is a row of its own under a row that fills them too.
    const fills = (index: number): boolean => (lineAt(index)?.spans.length ?? 0) >= bands.length;
    const close = sameRow(above.box, below.box, pitch) && !(fills(end) && (rows.at(-1) ?? []).some(fills));
    const runLength = rowLength(candidates, end, pitch, bands.length);
    // A line set apart like a new section, such as a signature line, opens no column.
    const widen = pitch <= 0 || below.box.y - above.box.y <= pitch * SECTION_STEP;
    // Try the closest reading first: the line joins the row above, or starts a row of
    // several close lines, or else stands as a row of its own.
    const options = [
      ...(close ? [{ tight: true, members: [end] }] : []),
      { tight: false, members: Array.from({ length: runLength }, (_unused, offset) => end + offset) },
      { tight: false, members: [end] },
    ];
    let fitted: { tight: boolean; members: number[]; row: number[]; next: readonly ColumnBand[] } | undefined;
    for (const { tight, members } of options) {
      // A size change ends a table only once rows of its own size can stand as a table,
      // so a short item list keeps the smaller totals under it.
      if (sizedRows > MIN_COMPACT_ROWS && !sameSize(sizeOf(linesOf(members)), tableSize)) continue;
      const next = fittedBands(linesOf(members), bands, accepted, widen);
      const row = tight ? [...(rows.at(-1) ?? []), ...members] : members;
      if (next !== undefined && mergedRow(linesOf(row), next) !== undefined) {
        fitted = { tight, members, row, next };
        break;
      }
    }
    if (fitted === undefined) break;
    const { tight, members, row, next } = fitted;
    const length = members.length;
    if (!tight) {
      if (length === 1 && line.spans.length === 1) break;
      if (spansProse(linesOf(row), next)) break;
      const terminalNumeric = bodyLines > 0 && bodyNumeric;
      if (line.spans.length > 1 && opensSection(line, above.lines.at(-1), below.box.y - above.box.y, pitch, next, terminalNumeric)) break;
    }
    bands = next;
    const added = linesOf(members);
    accepted.push(...added);
    if (!tight && sameSize(sizeOf(added), tableSize)) sizedRows += 1;
    if (tight) rows[rows.length - 1] = row;
    else {
      const previous = rows.at(-1);
      const before = rows.at(-2);
      if (previous !== undefined && before !== undefined) insertSorted(steps, top(previous) - bottom(before));
      rows.push(row);
    }
    if (rows.length > 1) {
      bodyLines += added.length;
      bodyNumeric &&= added.every(numericEnd);
    }
    end += length;
  }
  // A tight line under the last row's fullest line is as often a note as a wrapped cell,
  // so the table keeps it only when another row follows.
  const last = rows.at(-1) ?? [];
  const cellCounts = last.map((index) => candidates[index]?.lines[0]?.spans.length ?? 0);
  const fullest = cellCounts.indexOf(Math.max(...cellCounts));
  while (last.length > fullest + 1) {
    last.pop();
    end -= 1;
  }

  return { rows, bands, seedBands, width, pitch: rowPitchNow() };
}

function bandGroupAt(candidates: readonly Candidate[], start: number): TableGroup | undefined {
  let seed = start;
  for (;;) {
    const current = candidates[seed];
    const next = candidates[seed + 1];
    if (bandRow(current) === undefined && !(seed === start && loneLabel(current))) return undefined;
    if (current !== undefined && next !== undefined && bandRow(next) !== undefined && compatibleTableRows(current, next)) break;
    seed += 1;
  }
  const grown = grownRows(candidates, seed);
  if (grown === undefined) return undefined;
  const { width, seedBands, bands } = grown;
  const rows = grown.rows.map((row) => [...row]);
  const linesOf = (indices: readonly number[]): TextLine[] => indices.flatMap((index) => candidates[index]?.lines ?? []);
  if (seed > start) {
    const labelled = leadingGroupLabels(candidates, start, seed, rows, bands, width);
    if (labelled !== undefined) return labelled;
    const headed = leadingHeader(candidates, start, seed, rows, bands, width, grown.pitch);
    return headed === undefined ? undefined : bandGroup(candidates, start, headed.rows, headed.bands);
  } else if (rows.every((row) => row.length === 1) && bands === seedBands &&
    linesOf(rows.flat()).every((line) => line.spans.length === width)) {
    return undefined;
  }
  return bandGroup(candidates, start, rows, bands);
}

/** Insert `value` into the ascending `sorted` in place. */
function insertSorted(sorted: number[], value: number): void {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  sorted.splice(low, 0, value);
}

/** The median of the ascending `sorted` with `value` added, without copying it. */
function medianWith(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  const at = (index: number): number => (index < low ? sorted[index] : index === low ? value : sorted[index - 1]) ?? 0;
  const count = sorted.length + 1;
  const middle = count >> 1;
  return count % 2 === 1 ? at(middle) : (at(middle - 1) + at(middle)) / 2;
}

/** The table group whose rows are `rows`, from `start`, with one merged line per row. */
function bandGroup(candidates: readonly Candidate[], start: number, rows: readonly (readonly number[])[], bands: readonly ColumnBand[]): TableGroup | undefined {
  const lines = rows.map((row) => mergedRow(row.flatMap((index) => candidates[index]?.lines ?? []).map((line) => partedOnBands(line, bands)), bands));
  if (lines.some((line) => line === undefined)) return undefined;
  const grid = inferTableGrid(lines as TextLine[], bands);
  if (grid === undefined) return undefined;
  const joined = rows.flatMap((row) => row.slice(1).map((index) => index - start));
  const end = (rows.at(-1)?.at(-1) ?? start) + 1;
  return {
    rule: "bands", candidates: candidates.slice(start, end), bands, ...grid,
    rows: grid.rows.map((row) => [...row]),
    ...(joined.length === 0 ? {} : { joined }),
  };
}

/**
 * Lines above the seed rows that a centred group label turns into header rows. Each
 * line is its own row, and the grid must read every one of them as a header.
 */
function leadingGroupLabels(
  candidates: readonly Candidate[], start: number, seed: number,
  rows: readonly (readonly number[])[], bands: readonly ColumnBand[], width: number,
): TableGroup | undefined {
  if (candidates.slice(start, seed).some((candidate) => (bandRow(candidate)?.spans.length ?? 0) >= width)) return undefined;
  // Labels above the seed read as header rows only under a top line with a cell over
  // several columns, centred or covering them; without one the grid finds one header row.
  const top = mergedRow((candidates[start]?.lines ?? []).map((line) => partedOnBands(line, bands)), bands);
  if (top === undefined || !(top.spans.some((span) => centeredRun(span, bands) !== undefined) ||
    (placeCells(top.spans, bands)?.some((cell) => cell.last > cell.first) ?? false))) return undefined;
  const group = bandGroup(candidates, start, [...Array.from({ length: seed - start }, (_unused, offset) => [start + offset]), ...rows], bands);
  const leading = seed - start;
  return group !== undefined && group.headerRows >= 2 && group.headerRows >= leading ? group : undefined;
}

/**
 * `rows` with the lines above the seed rows in front, when the top one is a header naming
 * every column and the rest fit the columns. Header labels may sit beside their column
 * rather than over it, so the returned bands stretch to cover them.
 */
function leadingHeader(
  candidates: readonly Candidate[], start: number, seed: number,
  seedRows: readonly (readonly number[])[], bands: readonly ColumnBand[], width: number, pitch: number,
): { rows: number[][]; bands: readonly ColumnBand[] } | undefined {
  const rows = seedRows.map((row) => [...row]);
  const above: number[][] = [];
  for (let index = seed - 1; index >= start; index -= 1) {
    const candidate = candidates[index];
    const below = candidates[index + 1];
    if (candidate === undefined || below === undefined || bandRow(candidate) === undefined) return undefined;
    // A line of words set close above a row of figures labels it rather than wraps into it.
    const target = above[0] ?? rows[0] ?? [];
    const labels = !(bandRow(candidate)?.spans ?? []).some((span) => /\p{N}/u.test(span.text)) &&
      target.some((member) => (bandRow(candidates[member])?.spans ?? []).some((span) => numberLike(span.text)));
    if (sameRow(candidate.box, below.box, pitch) && !labels) target.unshift(index);
    else if (nextRowWithin(candidate.box, below.box, pitch)) above.unshift([index]);
    else return undefined;
  }
  // The header is the lowest leading row with words where the body has figures, such as
  // `Amount` over amounts. Lines above it, such as an account line, are not the table's,
  // so the group starts at a later line instead.
  const lines = (row: readonly number[]): TextLine[] => row.flatMap((index) => candidates[index]?.lines ?? []);
  const placed = (line: TextLine): { col: number; text: string }[] =>
    (placeCells(line.spans, bands) ?? []).map((cell, index) => ({ col: cell.first, text: line.spans[index]?.text ?? "" }));
  const bodyCells = lines(rows.flat()).flatMap(placed);
  const numeric = new Set(bands.flatMap((_band, col) => {
    const cells = bodyCells.filter((cell) => cell.col === col);
    return cells.filter((cell) => numberLike(cell.text)).length * 2 > cells.length ? [col] : [];
  }));
  const labelsFigures = (row: readonly number[]): boolean => {
    const cells = lines(row).flatMap(placed);
    return cells.some((cell) => numeric.has(cell.col) && /\p{L}/u.test(cell.text)) && !cells.some((cell) => numberLike(cell.text));
  };
  // A seed row that already labels the figures is the table's own header, and lines set
  // in another size, such as a title, are not the table's.
  const header = above.findLastIndex(labelsFigures);
  const tableSize = sizeOf(lines(rows.flat()));
  if (header > 0 || (above.length > 0 && labelsFigures(rows[0] ?? [])) ||
    above.some((row) => !sameSize(sizeOf(lines(row)), tableSize))) return undefined;
  const top = above[0] ?? rows[0] ?? [];
  const headerLines = lines(top);
  let stretched = bands;
  const columns = new Set<number>();
  const headerCells: { col: number; text: string }[] = [];
  for (const line of headerLines) {
    const cols = placeCells(line.spans, stretched)?.map((cell) => cell.first) ?? headerPlacement(line.spans, stretched);
    if (cols === undefined) return undefined;
    stretched = bandsUnderHeader(line.spans, cols, stretched);
    cols.forEach((col, index) => {
      columns.add(col);
      headerCells.push({ col, text: line.spans[index]?.text ?? "" });
    });
  }
  // A header reads as one: bold, or words over a column of figures. The lines of an
  // address block above key-value lines are not.
  const labelsColumns = headerCells.some((cell) => numeric.has(cell.col) && /\p{L}/u.test(cell.text)) &&
    !headerCells.some((cell) => numberLike(cell.text));
  if (above.length > 0 && !labelsColumns && !headerLines.every(isBold)) return undefined;
  if (columns.size < width || stretched.some((band, index) => index > 0 && band.left <= (stretched[index - 1]?.right ?? 0))) return undefined;
  const body = above.slice(1).flat().flatMap((index) => candidates[index]?.lines ?? []);
  if (body.some((line) => placeCells(line.spans, stretched) === undefined)) return undefined;
  return { rows: [...above, ...rows], bands: stretched };
}

/**
 * A table under a bold header that names three or more columns, with as few as one
 * row, such as an invoice with a single line item. A row is a run of lines set closer
 * than a line apart, starting within two lines of the one above, with every cell
 * under a header column. The other rules need two matching rows to see a table.
 */
function headerLedGroupAt(candidates: readonly Candidate[], start: number): TableGroup | undefined {
  const header = candidates[start];
  const labels = bandRow(header)?.spans ?? [];
  if (header === undefined || labels.length < MIN_COMPACT_COLUMNS || !labels.every((span) => span.style?.bold === true)) return undefined;
  const bands = labels.map((span) => ({ left: span.x, right: span.x + span.width }));
  const lineHeight = header.box.height;
  const rows: number[][] = [[start]];
  for (let end = start + 1; ;) {
    const first = candidates[end];
    const above = candidates[end - 1];
    if (first === undefined || above === undefined || first.box.y - (above.box.y + above.box.height) > lineHeight * 2) break;
    const row = [end];
    for (let next = end + 1; (candidates[next]?.box.y ?? Number.POSITIVE_INFINITY) - (candidates[next - 1]?.box.y ?? 0) < lineHeight; next += 1) row.push(next);
    const lines = row.flatMap((index) => candidates[index]?.lines ?? []);
    const merged = row.every((index) => untagged(candidates[index]!) && candidates[index]?.lines.length === 1) &&
      !lines.some((line) => line.spans.some((span) => span.style?.bold === true))
      ? mergedRow(lines, bands)
      : undefined;
    if (merged === undefined || merged.spans.length < 2) break;
    rows.push(row);
    end += row.length;
  }
  if (rows.length < 2) return undefined;
  const cells = rows.slice(1).flat().flatMap((index) => candidates[index]?.lines ?? []).flatMap((line) => line.spans);
  const stretched = bands.map((band) => {
    const inside = cells.filter((span) => overlap(span, band) > 0);
    return {
      left: Math.min(band.left, ...inside.map((span) => span.x)),
      right: Math.max(band.right, ...inside.map((span) => span.x + span.width)),
    };
  });
  if (stretched.some((band, index) => index > 0 && band.left <= (stretched[index - 1]?.right ?? 0))) return undefined;
  return bandGroup(candidates, start, rows, stretched);
}

function equalWidthGroupAt(candidates: readonly Candidate[], start: number): TableGroup | undefined {
  const first = candidates[start];
  if (first === undefined || !isTableCandidate(first)) return undefined;
  const run = [first];
  for (const next of candidates.slice(start + 1)) {
    if (!isTableCandidate(next) || !compatibleTableRows(first, next)) break;
    run.push(next);
  }
  const group = run.slice(0, rowsWithinPitch(run));
  const rows = group.flatMap((candidate) => candidate.lines.map((line) => line.spans.map((span) => cellText(span.text))));
  const width = rows[0]?.length ?? 0;
  if (rows.length < 2 || width < 2 || rows.some((row) => row.length !== width)) return undefined;
  const bands = columnBands(group.flatMap((candidate) => candidate.lines));
  return { rule: "equal-width", candidates: group, rows, headerRows: 1, ...(bands === undefined ? {} : { bands }) };
}

const SENTENCE_END = /[.!?。！？]["'”’)）」』]*$/u;
/**
 * A final company form, title, or initials, such as `Inc.`, `Co.`, `S.A.` or `U.S.`: its full
 * stop abbreviates and does not end a sentence. Other short words, such as `Rome.`, still do.
 */
const ABBREVIATION = /(?:^|[\s,(])(?:inc|ltd|co|corp|cie|bros|llc|plc|gmbh|jr|sr|dr|mr|mrs|ms|st|no|nr|ave|dept)\.$/iu;
const INITIALS = /(?:^|[\s,(])(?:\p{Lu}\.)*\p{Lu}\.$/u;
const endsSentence = (text: string): boolean => SENTENCE_END.test(text) && !ABBREVIATION.test(text) && !INITIALS.test(text);
const PROSE_CELL_EMS = 12;

/** Whether the gap between `left` and `right` on a line is a column boundary although it is narrower than an em. */
type CellBoundary = (left: TextSpan, right: TextSpan) => boolean;

/**
 * A line's cells: runs of spans closer than one em, so a page that sets one span
 * per word, as MuPDF and OCR do, reads in phrases like a PDF.js text layer.
 * `boundary` keeps a narrower gap between two cells.
 */
function cellsOf(line: TextLine, boundary: CellBoundary = () => false): TextSpan[] {
  const cells: TextSpan[] = [];
  // The line's typical em: OCR boxes a short glyph such as `=` far below the text size.
  const em = median(line.spans.map(tableEm).filter((size) => size > 0));
  for (const span of line.spans) {
    const previous = cells.at(-1);
    if (previous === undefined || span.x - (previous.x + previous.width) >= em || boundary(previous, span)) {
      cells.push(span);
      continue;
    }
    const joined = {
      ...previous,
      text: previous.text + spanSeparator(previous, span) + span.text,
      width: span.x + span.width - previous.x,
    };
    phraseParts.set(joined, [...(phraseParts.get(previous) ?? [previous]), span]);
    cells[cells.length - 1] = joined;
  }
  return cells;
}

/** The spans each phrase cell was joined from, so a phrase that straddles two columns can be parted again. */
const phraseParts = new WeakMap<TextSpan, readonly TextSpan[]>();

/** The band `span` overlaps most, or -1 when it overlaps none. */
function bandIndex(span: TextSpan, bands: readonly ColumnBand[]): number {
  const overlaps = bands.map((band) => overlap(span, band));
  const best = overlaps.indexOf(Math.max(...overlaps));
  return (overlaps[best] ?? 0) > 0 ? best : -1;
}

/** `spans` as one span: their joined text over their combined box. */
function joinedSpan(spans: readonly TextSpan[]): TextSpan {
  const box = boxOfLines([{ y: 0, height: 0, text: "", spans }]);
  return { ...spans[0]!, ...box, text: joinSpanTexts(spans) };
}

/** The band holding at least half of `span`'s width, or -1. */
function bandHolding(span: TextSpan, bands: readonly ColumnBand[]): number {
  const col = bandIndex(span, bands);
  const band = bands[col];
  return band !== undefined && overlap(span, band) * 2 >= span.width ? col : -1;
}

/**
 * `line` with each phrase cell that straddles bands parted back into one cell per
 * band, when every span it was joined from lies mostly within a single band. A date
 * set close to its description joins it in a phrase above the rows that show the gap
 * between. A label such as `Total Due` stays whole, even read word by word over two columns.
 */
function partedOnBands(line: TextLine, bands: readonly ColumnBand[]): TextLine {
  let changed = false;
  const spans = line.spans.flatMap((span) => {
    const parts = phraseParts.get(span);
    const cols = parts?.map((part) => bandHolding(part, bands));
    if (parts === undefined || cols === undefined || cols.some((col) => col < 0) || new Set(cols).size < 2) return [span];
    // Only figures glued to words, as a date to its description, are parted: a phrase of words alone reads as one label.
    if (!parts.some((part) => numberLike(part.text)) || !parts.some((part) => /\p{L}/u.test(part.text))) return [span];
    changed = true;
    return [...new Set(cols)].map((col) => joinedSpan(parts.filter((_part, index) => cols[index] === col)));
  });
  return changed ? { ...line, spans } : line;
}

/** `line` as it fits `bands`: unchanged when it already does, else with its cells regrouped by band where that helps. */
function onBands(line: TextLine, bands: readonly ColumnBand[]): TextLine {
  return placeCells(line.spans, bands) !== undefined ? line : cellsOnBands(line, bands) ?? line;
}

/**
 * `line` with one cell per band it touches: its spans grouped by the band each
 * overlaps most. Undefined when a span falls in no band or the bands come out of order.
 */
export function cellsOnBands(line: TextLine, bands: readonly ColumnBand[]): TextLine | undefined {
  const cols = line.spans.map((span) => bandIndex(span, bands));
  if (cols.some((col, index) => col < 0 || (index > 0 && col < (cols[index - 1] ?? 0)))) return undefined;
  const spans = [...new Set(cols)].map((col) => joinedSpan(line.spans.filter((_span, index) => cols[index] === col)));
  return { ...line, text: spans.map((span) => span.text).join(" "), spans };
}

function joinSpanTexts(spans: readonly TextSpan[]): string {
  return spans.map((span, index) => (index === 0 ? "" : spanSeparator(spans[index - 1]!, span)) + span.text).join("");
}

/** Narrowest gap, in ems, that can still part two cells when the lines around it leave it empty. */
const RIVER_GAP = 0.5;
/** How many lines above and below a gap are checked for text crossing it. */
const RIVER_REACH = 4;
/**
 * A narrow gap between two words must be this much wider than the line's usual space
 * between words, since a line set in monospaced type spaces every word more than half
 * an em apart. Gaps beside figures are left alone, since a row of figures has no word spaces.
 */
const WORD_SPACE_RATIO = 1.5;
/** How many narrow gaps between words a line needs before they show its usual word space. */
const MIN_WORD_SPACES = 3;
const isWord = (span: TextSpan): boolean => /\p{L}/u.test(span.text) && !/\p{N}/u.test(span.text);
/** A three-digit group that continues a number set with spaces between its thousands. */
const THOUSANDS_GROUP = /^\p{Nd}{3}(?:[.,]\p{Nd}+)?(?![\p{Nd}])/u;

/**
 * Whether a gap from `left` to `right` on line `index` of `lines` (top-down) runs down
 * the page as a column boundary: more nearby lines have different cells on both sides
 * of it than have text crossing it. OCR boxes are padded and statements set a date
 * close to its description, so such a gap can be narrower than an em, yet text crosses
 * it far less often than it crosses the space between two words.
 */
function isRiver(lines: readonly TextLine[], index: number, left: TextSpan, right: TextSpan): boolean {
  // Digit groups of one number, as in `11 171 705`, line up down a column of right-aligned figures.
  if (/\p{Nd}$/u.test(left.text.trim()) && THOUSANDS_GROUP.test(right.text.trim())) return false;
  const em = median((lines[index]?.spans ?? [right]).map(tableEm).filter((size) => size > 0));
  const start = left.x + left.width;
  if (right.x - start < em * RIVER_GAP) return false;
  if (isWord(left) && isWord(right)) {
    const spans = lines[index]?.spans ?? [];
    const spaces = spans.slice(1).flatMap((span, at) => {
      const before = spans[at];
      const gap = before === undefined ? 0 : span.x - (before.x + before.width);
      return before !== undefined && isWord(before) && isWord(span) && gap > 0 && gap < em ? [gap] : [];
    });
    if (spaces.length >= MIN_WORD_SPACES && right.x - start < median(spaces) * WORD_SPACE_RATIO) return false;
  }
  const middle = (start + right.x) / 2;
  const own = new Set([left.text.trim(), right.text.trim()]);
  let crossing = 0;
  let parted = 0;
  let unprefixed = 0;
  for (const line of [...lines.slice(Math.max(0, index - RIVER_REACH), index), ...lines.slice(index + 1, index + 1 + RIVER_REACH)]) {
    if (line.spans.some((span) => span.x < middle && span.x + span.width > middle)) {
      crossing += 1;
      continue;
    }
    const before = line.spans.findLast((span) => span.x + span.width <= middle && span.x + span.width >= start - 2 * em);
    const after = line.spans.find((span) => span.x >= middle && span.x <= right.x + 2 * em);
    // Repeated rows of the same words line up by themselves; a column parts different values.
    if (before !== undefined && after !== undefined && !(own.has(before.text.trim()) && own.has(after.text.trim()))) parted += 1;
    // Full rows whose text starts at the gap with nothing before it, as rows without a
    // number do beside a numbered label such as `1.5 Produits`, show the left part is an
    // optional prefix rather than a column when they outnumber the parted rows. A wrapped
    // line of a description has no cells further right, so it does not count.
    else if (before === undefined && after !== undefined && Math.abs(after.x - right.x) <= em &&
      line.spans.some((span) => span.x > after.x + after.width + em)) unprefixed += 1;
  }
  return parted >= crossing + 2 && parted > unprefixed;
}

const phraseGroups = new WeakMap<readonly Candidate[], readonly Candidate[]>();
/** Phrase candidates: every gap left between their cells is an em or a column boundary. */
const phrases = new WeakSet<Candidate>();

const lineIds = new WeakMap<TextLine, number>();
let nextLineId = 0;
const lineId = (line: TextLine): number => {
  let id = lineIds.get(line);
  if (id === undefined) {
    id = nextLineId++;
    lineIds.set(line, id);
  }
  return id;
};

/**
 * A line's phrase cells by the lines within {@link RIVER_REACH} of it, which are all that
 * {@link isRiver} reads. The analyzer vets many overlapping runs of a page's lines, and a
 * line keeps its neighbours in most of them. {@link resetTableAnalysis} empties it before
 * each document, so a document edited in place between conversions is read afresh.
 */
let phraseCells = new WeakMap<TextLine, Map<string, TextSpan[]>>();

/** Forget what earlier documents taught the table analysis; call before analyzing a document. */
export function resetTableAnalysis(): void {
  phraseCells = new WeakMap();
}

function phrasedLine(lines: readonly TextLine[], index: number): TextSpan[] {
  const line = lines[index]!;
  const key = lines.slice(Math.max(0, index - RIVER_REACH), index + 1 + RIVER_REACH).map(lineId).join(",");
  const known = phraseCells.get(line) ?? new Map<string, TextSpan[]>();
  phraseCells.set(line, known);
  let cells = known.get(key);
  if (cells === undefined) {
    cells = cellsOf(line, (left, right) => isRiver(lines, index, left, right));
    known.set(key, cells);
  }
  return cells;
}

function phraseGroup(candidates: readonly Candidate[]): readonly Candidate[] {
  const cached = phraseGroups.get(candidates);
  if (cached !== undefined) return cached;
  const lines = candidates.flatMap((candidate) => candidate.lines).sort((a, b) => a.y - b.y);
  const order = new Map(lines.map((line, index) => [line, index]));
  const grouped = candidates.map((candidate) => {
    if (candidate.role === "table") return candidate;
    const phrased = {
      ...candidate,
      lines: candidate.lines.map((line) => ({ ...line, spans: phrasedLine(lines, order.get(line) ?? 0) })),
    };
    phrases.add(phrased);
    return phrased;
  });
  phraseGroups.set(candidates, grouped);
  return grouped;
}

/** Each candidate's lines as cells, grouped as {@link phraseGroup} groups them among `candidates`. */
function lineCells(candidates: readonly Candidate[]): TextSpan[][][] {
  return phraseGroup(candidates).map((candidate) =>
    candidate.lines.map((line) => phrases.has(candidate) ? [...line.spans] : cellsOf(line)));
}

function wrapsSentences(candidates: readonly Candidate[]): boolean {
  const rows = lineCells(candidates).map((lines) => lines.flat());
  return rows.some((row, index) => index > 0 && row.some((cell) => {
    if (!endsSentence(cell.text.trim())) return false;
    const em = tableEm(cell);
    const above = rows[index - 1]?.find((span) => Math.abs(span.x - cell.x) <= em);
    return above !== undefined && above.width >= PROSE_CELL_EMS * em && !SENTENCE_END.test(above.text.trim());
  }));
}

// Three rows and columns establish a grid even when one descriptive cell is long.
const MIN_COMPACT_ROWS = 3;
const MIN_COMPACT_COLUMNS = 3;
const MAX_LONG_CELLS = 1;

/** Whether `below` follows `above` closer than a wrapped line does. */
const closeLines = (above: Candidate | undefined, below: Candidate | undefined): boolean =>
  above !== undefined && below !== undefined && below.box.y - above.box.y < above.box.height * MAX_WRAP_STEP;

function hasCompactRowsWithWrapping(candidates: readonly Candidate[]): boolean {
  const cells = lineCells(candidates).map((lines) => lines.flat());
  const full = cells.filter((row) => row.length >= MIN_COMPACT_COLUMNS);
  // A row of two cells is a sparse row while full rows remain the majority of the rows,
  // when a figure shows it: a total whose other figures OCR missed, a dated description,
  // or a description whose figures sit on a line close beside it. A key and its value,
  // such as `Due Date` `January 31, 2016`, are not. Wrapped lines of one cell are not rows.
  const rows = cells.filter((row) => row.length >= 2).length;
  const figures = (index: number): boolean => (cells[index]?.length ?? 0) > 0 && cells[index]!.every((cell) => numberLike(cell.text));
  const sparse = (row: readonly TextSpan[], index: number): boolean => row.length === 2 && full.length * 2 > rows &&
    (row.some((cell) => numberLike(cell.text)) ||
      (figures(index - 1) && closeLines(candidates[index - 1], candidates[index])) ||
      (figures(index + 1) && closeLines(candidates[index], candidates[index + 1])));
  return full.length >= MIN_COMPACT_ROWS &&
    full.every((row) => row.filter((cell) => cell.width >= PROSE_CELL_EMS * tableEm(cell)).length <= MAX_LONG_CELLS) &&
    cells.every((row, index) => row.length >= MIN_COMPACT_COLUMNS || sparse(row, index) ||
      (row.length === 1 && index > 0 && (closeLines(candidates[index - 1], candidates[index]) || closeLines(candidates[index], candidates[index + 1]))));
}

/** Whether grouped rows read as a table rather than columns of text: the analyzer's test for every group. */
export function looksLikeTableGroup(candidates: readonly Candidate[]): boolean {
  if (candidates.some((candidate) => candidate.role === "table")) return true;
  if (candidates.length < 2) return false;
  const first = candidates[0]?.lines.flatMap((line) => line.spans) ?? [];
  const remaining = candidates.slice(1).flatMap((candidate) => candidate.lines.flatMap((line) => line.spans));
  const second = candidates[1]?.lines.flatMap((line) => line.spans) ?? [];
  const typographicHeader =
    (first.length >= 2 || (first.length === 1 && second.length >= 2 && second.every((span) => span.style?.bold === true))) &&
    first.every((span) => span.style?.bold === true) &&
    remaining.some((span) => span.style?.bold !== true);
  if (typographicHeader) return !wrapsSentences(candidates);

  if (hasCompactRowsWithWrapping(candidates) && !wrapsSentences(candidates)) return true;

  return (
    candidates.length >= 3 &&
    lineCells(candidates).every((lines) =>
      lines.every((cells) => cells.length >= 2 && cells.every((cell) => cell.text.trim().length <= 40) && cells.some((cell) => cell.width <= PROSE_CELL_EMS * (tableEm(cell)))),
    ) &&
    !wrapsSentences(candidates)
  );
}

/**
 * The table group starting at `candidates[start]`, trying the band rule before the
 * equal-width rule. `accept` vets each rule's group, so a rejected band group can
 * still fall back to the equal-width group.
 */
export function tableGroupAt(
  candidates: readonly Candidate[],
  start: number,
  accept: (group: TableGroup) => boolean = () => true,
): TableGroup | undefined {
  const phrases = phraseGroup(candidates);
  const restore = (group: TableGroup | undefined): TableGroup | undefined => group === undefined ? undefined : {
    ...group, candidates: candidates.slice(start, start + group.candidates.length),
  };
  const firstAccepted = (input: readonly Candidate[]): TableGroup | undefined => {
    for (const detect of [bandGroupAt, equalWidthGroupAt, headerLedGroupAt]) {
      const group = restore(detect(input, start));
      if (group !== undefined && accept(group)) return group;
    }
    return undefined;
  };
  // Raw spans keep tight columns apart, but stop at the first row whose cell spans
  // several words; phrases continue past it. Phrases win only when they keep every
  // column the raw spans found, so a longer group never costs a column.
  const raw = firstAccepted(candidates);
  const phrased = firstAccepted(phrases);
  if (raw === undefined) return phrased;
  const columns = (group: TableGroup): number => Math.max(0, ...group.rows.map((row) => row.length));
  return phrased !== undefined && phrased.candidates.length > raw.candidates.length && columns(phrased) >= columns(raw)
    ? phrased
    : raw;
}

/** Ids of the candidates in table groups of two or more rows, scanning in the given order. */
export function tableGroupIds(
  candidates: readonly Candidate[],
  accept?: (group: TableGroup) => boolean,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let index = 0; index < candidates.length; ) {
    const group = tableGroupAt(candidates, index, accept);
    if (group === undefined || group.candidates.length < 2) {
      index += 1;
      continue;
    }
    for (const candidate of group.candidates) ids.add(candidate.id);
    index += group.candidates.length;
  }
  return ids;
}

/** Ids of the candidates that are rows of a table, scanning the page top-down. */
export function tableRowIds(candidates: readonly Candidate[]): ReadonlySet<string> {
  return tableGroupIds(
    [...candidates].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x),
    (group) => looksLikeTableGroup(group.candidates),
  );
}
