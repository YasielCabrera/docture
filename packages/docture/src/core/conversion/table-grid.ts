import type { TableCellSpan } from "../domain/conversion.js";
import type { LayoutBox, TextLine, TextSpan } from "../domain/geometry.js";
import { boxOfLines, compatibleTableRows, HEADING_SIZE_RATIO, isTableCandidate, median, type Candidate } from "./candidates.js";

const MAX_ROW_STEP = 3;
const SECTION_STEP = 1.5;
const CENTER_TOLERANCE = 0.1;
const CAPTION = /^\s*(?:table|figure|fig\.|chart|exhibit)\s+(?:[\p{N}ivxlc]|\p{L}(?!\p{L}))/iu;
const TABLE_LABEL = /^\s*table\s+([\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*)/iu;
const CONTINUED = /\b(?:continued|cont(?:['’]d|\.))/iu;

export function tableLabel(caption: string): string | undefined {
  return TABLE_LABEL.exec(caption)?.[1]?.toLowerCase();
}

/** The table a `Table N (continued)` line names, if `text` is one. */
export function continuedTableLabel(text: string): string | undefined {
  return CONTINUED.test(text) ? tableLabel(text) : undefined;
}

/** The median step between the tops of consecutive `boxes`, top-down; 0 below two boxes. */
export function rowPitch(boxes: readonly LayoutBox[]): number {
  return median(boxes.slice(1).map((box, index) => box.y - (boxes[index]?.y ?? box.y)));
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
  for (let count = 2; count < rows.length; count += 1) {
    const above = rows[count - 1];
    const below = rows[count];
    if (above === undefined || below === undefined || below.role === "table") continue;
    if (!nextRowWithin(above.box, below.box, rowPitch(rows.slice(0, count).map((row) => row.box)))) return count;
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
  const placements: Placement[] = [];
  for (const [index, row] of overlaps.entries()) {
    const best = row.reduce((found, value, col) => (value > (row[found] ?? 0) ? col : found), 0);
    if ((row[best] ?? 0) <= 0) return undefined;
    const covered = bands.flatMap((band, col) =>
      (row[col] ?? 0) > (band.right - band.left) / 2 &&
      overlaps.every((other, otherIndex) => otherIndex === index || (other[col] ?? 0) <= 0)
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
    rows[row]![cell.first] = span.text.trim();
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

function bandRow(candidate: Candidate | undefined): TextLine | undefined {
  const line = candidate?.lines[0];
  if (candidate === undefined || line === undefined || candidate.role !== undefined || candidate.lines.length !== 1) return undefined;
  const gap = median(line.spans.map((span) => span.height).filter((height) => height > 0)) || 10;
  const separated = line.spans.every((span, index) => {
    const next = line.spans[index + 1];
    return next === undefined || next.x - (span.x + span.width) >= gap;
  });
  return separated && line.spans.length >= 2 ? line : undefined;
}

const loneLabel = (candidate: Candidate | undefined): boolean =>
  candidate !== undefined && candidate.role === undefined && candidate.lines.length === 1 && candidate.lines[0]?.spans.length === 1;

/** Whether `candidate` joins a table with `bands` by the band rule, as a row with at most one cell per band. */
export function fitsBands(candidate: Candidate, bands: readonly ColumnBand[]): boolean {
  const line = bandRow(candidate);
  return line !== undefined && line.spans.length <= bands.length && placeCells(line.spans, bands) !== undefined;
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
  const first = candidates[seed];
  const width = bandRow(first)?.spans.length ?? 0;
  if (first === undefined || candidates.slice(start, seed).some((candidate) => (bandRow(candidate)?.spans.length ?? 0) >= width)) {
    return undefined;
  }
  const matchesSeed = (candidate: Candidate | undefined): boolean =>
    candidate !== undefined && bandRow(candidate) !== undefined && compatibleTableRows(first, candidate);
  let end = seed + 1;
  while (matchesSeed(candidates[end])) end += 1;
  end = seed + rowsWithinPitch(candidates.slice(seed, end));
  const bands = columnBands(candidates.slice(seed, end).flatMap((candidate) => candidate.lines));
  if (bands === undefined) return undefined;
  for (;;) {
    const line = bandRow(candidates[end]);
    const above = candidates[end - 1];
    const below = candidates[end];
    const pitch = rowPitch(candidates.slice(seed, end).map((candidate) => candidate.box));
    if (line === undefined || above === undefined || below === undefined || line.spans.length > width) break;
    if (!nextRowWithin(above.box, below.box, pitch) || placeCells(line.spans, bands) === undefined) break;
    const body = candidates.slice(seed + 1, end).flatMap((candidate) => candidate.lines);
    const terminalNumeric = body.length > 0 && body.every((row) => row.spans.length < width || /\p{N}/u.test(row.spans[width - 1]?.text ?? ""));
    if (opensSection(line, above.lines.at(-1), below.box.y - above.box.y, pitch, bands, terminalNumeric)) break;
    end += 1;
  }
  const group = candidates.slice(start, end);
  const lines = group.flatMap((candidate) => candidate.lines);
  if (lines.every((line) => line.spans.length === width)) return undefined;
  const grid = inferTableGrid(lines, bands);
  const leading = seed - start;
  if (grid === undefined || (leading > 0 && (grid.headerRows < 2 || grid.headerRows < leading))) return undefined;
  return { rule: "bands", candidates: group, bands, ...grid };
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
  const rows = group.flatMap((candidate) => candidate.lines.map((line) => line.spans.map((span) => span.text.trim())));
  const width = rows[0]?.length ?? 0;
  if (rows.length < 2 || width < 2 || rows.some((row) => row.length !== width)) return undefined;
  const bands = columnBands(group.flatMap((candidate) => candidate.lines));
  return { rule: "equal-width", candidates: group, rows, headerRows: 1, ...(bands === undefined ? {} : { bands }) };
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
  if (typographicHeader) return true;

  return (
    candidates.length >= 3 &&
    candidates.every((candidate) =>
      candidate.lines.every(
        (line) =>
          line.spans.length >= 2 &&
          line.spans.every((span) => span.text.trim().length <= 40),
      ),
    )
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
  const bands = bandGroupAt(candidates, start);
  if (bands !== undefined && accept(bands)) return bands;
  const equal = equalWidthGroupAt(candidates, start);
  return equal !== undefined && accept(equal) ? equal : undefined;
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
