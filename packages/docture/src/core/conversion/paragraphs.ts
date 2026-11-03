import type { TextSpan } from "../domain/geometry.js";
import { characterFontSize, isMonospace, median, unionBox, type Candidate } from "./candidates.js";

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

function typography(candidate: Candidate): Typography {
  const spans = candidate.lines.flatMap((line) => line.spans);
  const mostly = (test: (span: TextSpan) => boolean) =>
    spans.length > 0 && spans.filter(test).length >= spans.length / 2;
  return {
    size: characterFontSize(spans) || median(spans.map((span) => span.height)),
    bold: mostly((span) => span.style?.bold === true),
    monospace: mostly(isMonospace),
  };
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
  const style = typography(first);
  if (!sameTypography(style, typography(next))) return false;

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

/**
 * The right edge of the widest running-text line in the same typography that
 * shares horizontal space with `first`: the column measure a wrapped line fills.
 */
function columnMeasure(candidates: readonly Candidate[], first: Candidate): number {
  const style = typography(first);
  return Math.max(...candidates
    .filter((candidate) => mergeable(candidate) && sameTypography(style, typography(candidate)) &&
      candidate.box.x < first.box.x + first.box.width && first.box.x < candidate.box.x + candidate.box.width)
    .map((candidate) => candidate.box.x + candidate.box.width));
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
): number {
  const first = candidates[start];
  if (first === undefined || !mergeable(first)) return 1;
  const measure = columnMeasure(candidates, first);
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
