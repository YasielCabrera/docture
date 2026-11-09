import type { LayoutBox } from "../domain/geometry.js";
import { characterFontSize, isBold, isMonospace, median, mostCharacters, unionBox, type Candidate } from "./candidates.js";

/** Font sizes within this fraction of each other set the same text. */
const SIZE_TOLERANCE = 0.05;
/** Consecutive lines of one block sit at least this many font sizes apart; closer lines overlap. */
const MIN_PITCH = 0.7;
/** A line pitch this many font sizes or more is a gap between blocks. */
const MAX_PITCH = 1.6;
/** How much, in font sizes, a line's pitch may exceed the block's own pitch. */
const PITCH_TOLERANCE = 0.25;
/**
 * A gap between spans this many font sizes wide separates columns or cells. A
 * justified line can stretch a space to about one font size.
 */
const COLUMN_GAP = 1.5;
/** Left edges further apart than this many font sizes start different paragraphs. */
const INDENT = 0.8;

const MERGEABLE_ROLES = new Set<Candidate["role"]>([undefined, "paragraph", "code"]);

interface Typography {
  readonly size: number;
  readonly bold: boolean;
  readonly monospace: boolean;
}

const typographies = new WeakMap<Candidate, Typography>();

function typography(candidate: Candidate): Typography {
  const known = typographies.get(candidate);
  if (known !== undefined) return known;
  const spans = candidate.lines.flatMap((line) => line.spans);
  const found = {
    size: characterFontSize(spans) || median(spans.map((span) => span.height)),
    bold: mostCharacters(spans, isBold),
    monospace: mostCharacters(spans, isMonospace),
  };
  typographies.set(candidate, found);
  return found;
}

function sameTypography(a: Typography, b: Typography): boolean {
  return a.bold === b.bold && a.monospace === b.monospace &&
    a.size > 0 && Math.abs(a.size - b.size) <= a.size * SIZE_TOLERANCE;
}

/** The baseline of a line's longest span, which superscripts and inline marks do not move. */
function baseline(candidate: Candidate): number {
  const spans = candidate.lines[0]?.spans ?? [];
  const longest = spans.reduce<(typeof spans)[number] | undefined>(
    (best, span) => (best === undefined || span.text.length > best.text.length ? span : best),
    undefined,
  );
  return longest === undefined ? candidate.box.y + candidate.box.height : longest.y + longest.height;
}

function opensBold(candidate: Candidate): boolean {
  const span = candidate.lines[0]?.spans.find((item) => item.text.trim() !== "");
  return span !== undefined && isBold(span);
}

function closesMonospace(candidate: Candidate): boolean {
  const span = candidate.lines.at(-1)?.spans.findLast((item) => item.text.trim() !== "");
  return span !== undefined && isMonospace(span);
}

function firstWordWidth(candidate: Candidate): number {
  const span = candidate.lines[0]?.spans[0];
  if (span === undefined || span.text.length === 0) return 0;
  const word = /^\s*(?:\p{Ideographic}|[^\s\p{Ideographic}]+)/u.exec(span.text)?.[0] ?? span.text;
  return (span.width * word.length) / span.text.length;
}

/** Whether two spans of the line sit far enough apart to be separate columns or table cells. */
function hasColumnGap(candidate: Candidate): boolean {
  const spans = candidate.lines[0]?.spans ?? [];
  const limit = typography(candidate).size * COLUMN_GAP;
  return spans.some((span, index) => {
    const next = spans[index + 1];
    return next !== undefined && next.x - (span.x + span.width) >= limit;
  });
}

/** A single line of running text: not a loader-grouped block, and not split into columns or cells. */
function mergeable(candidate: Candidate): boolean {
  return candidate.lines.length === 1 && MERGEABLE_ROLES.has(candidate.role) &&
    (candidate.lines[0]?.spans.length ?? 0) > 0 && !hasColumnGap(candidate);
}

/**
 * Whether `next` is the following visual line of the paragraph or code listing
 * in `block`. `after` is the line below `next`, which tells whether the gap
 * above `next` is the block's own line spacing or a gap between paragraphs.
 */
function continuesBlock(
  block: readonly Candidate[],
  next: Candidate,
  after: Candidate | undefined,
  measure: number,
): boolean {
  const first = block[0];
  const previous = block[block.length - 1];
  if (first === undefined || previous === undefined) return false;
  if (!mergeable(next) || next.role !== first.role) return false;
  const lead = typography(first);
  const last = typography(previous);
  const style = lead.bold && !last.bold ? last : lead;
  const nextStyle = typography(next);
  const endsLead = style.bold && !nextStyle.bold && opensBold(next) && sameTypography(style, { ...nextStyle, bold: true });
  const endsCode = !style.monospace && nextStyle.monospace && closesMonospace(previous) &&
    sameTypography(style, { ...nextStyle, monospace: false });
  if (!sameTypography(style, nextStyle) && !endsLead && !endsCode) return false;

  const box = unionBox(block.map((candidate) => candidate.box));
  const overlap = Math.min(box.x + box.width, next.box.x + next.box.width) - Math.max(box.x, next.box.x);
  if (overlap <= 0) return false;

  const pitch = baseline(next) - baseline(previous);
  if (pitch < style.size * MIN_PITCH || pitch >= style.size * MAX_PITCH) return false;
  const second = block[1];
  const following = after !== undefined && sameTypography(style, typography(after)) ? baseline(after) - baseline(next) : 0;
  const expected = second !== undefined
    ? baseline(second) - baseline(first)
    : following > 0 ? Math.min(pitch, following) : pitch;
  if (pitch > expected + style.size * PITCH_TOLERANCE) return false;

  if (style.monospace || first.role === "code") return true;
  const right = Math.max(box.x + box.width, next.box.x + next.box.width, measure);
  const slack = right - (previous.box.x + previous.box.width);
  if (slack > firstWordWidth(next) + style.size) return false;
  // The second line may sit left of a first-line indent or right of it under a
  // hanging indent. Every later line starts where the second did.
  return second === undefined || Math.abs(next.box.x - second.box.x) <= style.size * INDENT;
}

function sideOf(box: LayoutBox, gutter: number): "left" | "right" | undefined {
  if (box.x + box.width <= gutter) return "left";
  if (box.x >= gutter) return "right";
  return undefined;
}

type Side = ReturnType<typeof sideOf> | "crossing";

interface MeasureRow {
  readonly lefts: number[];
  readonly rights: number[];
}

interface MeasureIndex {
  readonly gutter: number | undefined;
  readonly rows: Map<string, MeasureRow>;
  readonly sizes: number[];
}

const measureIndexes = new WeakMap<readonly Candidate[], MeasureIndex>();

const measureKey = (style: Typography, side: Side, size: number): string =>
  `${style.bold ? 1 : 0}${style.monospace ? 1 : 0}${side ?? "crossing"}:${size}`;

function measureIndex(candidates: readonly Candidate[], gutter: number | undefined): MeasureIndex {
  const known = measureIndexes.get(candidates);
  if (known !== undefined && known.gutter === gutter) return known;
  const groups = new Map<string, Candidate[]>();
  const sizes = new Set<number>();
  for (const candidate of candidates) {
    if (!mergeable(candidate)) continue;
    const style = typography(candidate);
    const side = gutter === undefined ? "crossing" : sideOf(candidate.box, gutter) ?? "crossing";
    const key = measureKey(style, side, style.size);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
    sizes.add(style.size);
  }
  const rows = new Map<string, MeasureRow>();
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.box.x - b.box.x);
    let widest = Number.NEGATIVE_INFINITY;
    rows.set(key, {
      lefts: sorted.map((candidate) => candidate.box.x),
      rights: sorted.map((candidate) => (widest = Math.max(widest, candidate.box.x + candidate.box.width))),
    });
  }
  const index = { gutter, rows, sizes: [...sizes] };
  measureIndexes.set(candidates, index);
  return index;
}

function countBelow(values: readonly number[], limit: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((values[middle] ?? 0) < limit) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The right edge of the widest running-text line in the same typography that
 * shares horizontal space with `first`: the column measure a wrapped line fills.
 */
function columnMeasure(candidates: readonly Candidate[], first: Candidate, gutter: number | undefined): number {
  const style = typography(first);
  if (!(style.size > 0)) return Number.NEGATIVE_INFINITY;
  const index = measureIndex(candidates, gutter);
  const own = gutter === undefined ? undefined : sideOf(first.box, gutter);
  const sides: readonly Side[] = own === undefined ? ["left", "right", "crossing"] : [own];
  let widest = Number.NEGATIVE_INFINITY;
  for (const size of index.sizes) {
    if (Math.abs(style.size - size) > style.size * SIZE_TOLERANCE) continue;
    for (const side of sides) {
      const row = index.rows.get(measureKey(style, side, size));
      if (row === undefined) continue;
      const count = countBelow(row.lefts, first.box.x + first.box.width);
      if (count > 0) widest = Math.max(widest, row.rights[count - 1] ?? Number.NEGATIVE_INFINITY);
    }
  }
  return widest > first.box.x ? widest : Number.NEGATIVE_INFINITY;
}

/**
 * How many candidates from `start` are the wrapped lines of one paragraph or
 * code listing. Loaders such as PDF.js and MuPDF return each visual line as its
 * own block. `opensBlock` marks indexes where a list or table starts.
 */
export function paragraphLength(
  candidates: readonly Candidate[],
  start: number,
  opensBlock: (index: number) => boolean,
  gutter?: number,
): number {
  const first = candidates[start];
  if (first === undefined || !mergeable(first)) return 1;
  const measure = columnMeasure(candidates, first, gutter);
  const block: Candidate[] = [first];
  for (let index = start + 1; index < candidates.length; index += 1) {
    const next = candidates[index];
    if (next === undefined || opensBlock(index)) break;
    if (!continuesBlock(block, next, candidates[index + 1], measure)) break;
    block.push(next);
  }
  return block.length;
}

/** One candidate holding every line of `group`, keeping each line's source ids. */
export function mergeCandidates(group: readonly Candidate[]): Candidate {
  const [first, ...rest] = group;
  if (first === undefined) throw new RangeError("Cannot merge an empty candidate group.");
  if (rest.length === 0) return first;
  return {
    ...first,
    sourceIds: group.flatMap((candidate) => candidate.sourceIds ?? [candidate.id]),
    lineIds: group.flatMap((candidate) => candidate.lineIds),
    box: unionBox(group.map((candidate) => candidate.box)),
    lines: group.flatMap((candidate) => candidate.lines),
  };
}
