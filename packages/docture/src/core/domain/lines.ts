/**
 * Turning positioned words into lines.
 *
 * Every geometry-producing loader needs this and none of them should own it: a
 * text layer reports words, Tesseract reports words, PaddleOCR reports text
 * lines, and all three have to arrive at the same {@link TextLine} shape or the
 * parsers downstream cannot be shared. (In the repo this library replaces, this
 * logic had been copy-pasted into three loaders and drifted in all three.)
 */

import type { TextLine, TextSpan, TextStyle } from "./geometry.js";

/** One word as a producer reports it: text plus an axis-aligned box. */
export interface PositionedWord {
  readonly text: string;
  /** `[xMin, yMin, xMax, yMax]`, top-left origin, any consistent unit. */
  readonly box: readonly [number, number, number, number];
  /** 0–1, when the producer knows. */
  readonly confidence?: number;
  readonly direction?: TextSpan["direction"];
  /** See {@link TextSpan.rotation}. */
  readonly rotation?: number;
  /** `fontSize` is in the box's unit and is scaled with it. */
  readonly style?: TextStyle;
  readonly href?: string;
}

export interface LinesFromWordsOptions {
  /**
   * Multiplied into every coordinate and font size. An OCR engine working on a 300-DPI raster
   * passes `72 / 300` to land back in PDF points.
   */
  readonly scale?: number;
  /**
   * How far two words' vertical centres may sit apart and still be one line,
   * as a fraction of the median word height. Default 0.5 — half a line height,
   * which tolerates subscripts and OCR jitter without merging adjacent rows.
   */
  readonly lineTolerance?: number;
  /**
   * The angle the page's text lines are turned by, in radians, positive when a line
   * descends to the right in the y-down frame of the boxes. Words are grouped along
   * it, so a row of a tilted scan stays one line across the whole page.
   * `"estimate"` measures it from the words. Default 0:
   * an upright page, as a text layer is.
   */
  readonly skew?: number | "estimate";
}

function scaledStyle(style: TextStyle, scale: number): TextStyle {
  return style.fontSize === undefined || scale === 1 ? style : { ...style, fontSize: style.fontSize * scale };
}

/** Median of a non-empty numeric array. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const WORD_GAP = 0.15;
const LETTER_GAP = 0.05;

const TURNED_DEGREES = 10;

export function isTurned(span: Pick<TextSpan, "rotation">): boolean {
  return Math.abs(span.rotation ?? 0) >= TURNED_DEGREES;
}

function emSize(span: TextSpan): number {
  return span.style?.fontSize ?? span.height;
}

function sameFont(previous: TextSpan, next: TextSpan): boolean {
  return previous.style?.fontFamily !== undefined && previous.style.fontFamily === next.style?.fontFamily &&
    emSize(previous) === emSize(next);
}

function isRightToLeft(spans: readonly TextSpan[]): boolean {
  const rtl = spans.filter((span) => span.direction === "rtl").length;
  return rtl > spans.length - rtl;
}

export function readingOrderSpans(spans: readonly TextSpan[]): TextSpan[] {
  return isRightToLeft(spans)
    ? [...spans].sort((a, b) => b.x + b.width - (a.x + a.width))
    : [...spans].sort((a, b) => a.x - b.x);
}

export function spanSeparator(previous: TextSpan, next: TextSpan): "" | " " {
  if (/\s$/u.test(previous.text) || /^\s/u.test(next.text)) return "";
  const gap = next.x >= previous.x
    ? next.x - (previous.x + previous.width)
    : previous.x - (next.x + next.width);
  const size = Math.min(emSize(previous), emSize(next));
  const shift = Math.abs(previous.y + previous.height - (next.y + next.height));
  const letters = /[\p{L}\p{N}]$/u.test(previous.text) && /^[\p{L}\p{N}]/u.test(next.text);
  const limit = letters && sameFont(previous, next) ? LETTER_GAP : WORD_GAP;
  const touching = size > 0 && Math.abs(gap) <= size * limit && shift <= size * WORD_GAP;
  return touching ? "" : " ";
}

export function joinSpans(spans: readonly TextSpan[]): string {
  return spans
    .map((span, index) => {
      const previous = spans[index - 1];
      return previous === undefined ? span.text : spanSeparator(previous, span) + span.text;
    })
    .join("");
}

/**
 * Group words into visual lines, sorted top-to-bottom with each line's spans
 * in reading order.
 *
 * Words whose text is blank are dropped — a blank box carries no information and
 * would widen line boxes for nothing.
 */
export function linesFromWords(
  words: readonly PositionedWord[],
  options: LinesFromWordsOptions = {},
): TextLine[] {
  const scale = options.scale ?? 1;
  const tolerance = options.lineTolerance ?? 0.5;

  const spans = words
    .filter((w) => w.text.trim() !== "")
    .map((w) => {
      const [xMin, yMin, xMax, yMax] = w.box;
      const span: TextSpan = {
        text: w.text,
        x: xMin * scale,
        y: yMin * scale,
        width: (xMax - xMin) * scale,
        height: (yMax - yMin) * scale,
        ...(w.confidence === undefined ? {} : { confidence: w.confidence }),
        ...(w.direction === undefined ? {} : { direction: w.direction }),
        ...(w.rotation === undefined || w.rotation === 0 ? {} : { rotation: w.rotation }),
        ...(w.style === undefined ? {} : { style: scaledStyle(w.style, scale) }),
        ...(w.href === undefined ? {} : { href: w.href }),
      };
      return span;
    });

  if (spans.length === 0) return [];
  const horizontal = spans.filter((span) => !isTurned(span));
  const skew = options.skew === "estimate" ? skewOf(horizontal, tolerance, MAX_SKEW_DEGREES) ?? 0 : options.skew ?? 0;
  const slope = Math.tan(skew);
  const rotated = spans.filter(isTurned);
  if (rotated.length > 0) {
    return [...horizontalLines(horizontal, tolerance, slope), ...rotatedLines(rotated, tolerance)].sort((a, b) => a.y - b.y);
  }
  return horizontalLines(spans, tolerance, slope);
}

/** Steepest tilt {@link estimateSkew} considers by default, in degrees. A scan turned further needs real deskewing. */
const MAX_SKEW_DEGREES = 5;
const SKEW_STEP_DEGREES = 0.1;
/**
 * How much better the best angle must align the words than 0 does before a page counts
 * as tilted. Upright pages gained at most 4% from any angle; pages tilted 0.6–1 degree
 * gained 20% or more.
 */
const SKEW_MIN_GAIN = 0.1;
/** Widest gap between two words of one phrase, in median word heights. Word spaces are about a third of one. */
const PHRASE_GAP = 1;
/** Fewest words a phrase needs before its slope counts, and fewest such phrases a page needs. */
const PHRASE_WORDS = 3;
const PHRASES = 2;
/**
 * How far the phrases' own slope may differ from the estimate, as a fraction of it, or
 * by 0.3 degrees on a page tilted less than that.
 */
const PHRASE_AGREEMENT = 0.5;
const PHRASE_SLOPE_FLOOR = Math.tan((0.3 * Math.PI) / 180);
/** Fewest rows of three separate cells or more that must line up at the angle on a page without phrases. */
const ALIGNED_ROWS = 3;
/**
 * Line pitch over box height below which a column's boxes are too close to be upright.
 * On 19 real pages rendered upright, PaddleOCR's padded boxes measured 0.85 or more and
 * no Tesseract word had a box within its own height below it.
 */
const STACKED_PITCH = 0.5;
/** Fewest boxes a column needs before its lean counts, and how far below a box, in median box heights, the next one may sit. */
const COLUMN_BOXES = 4;
const COLUMN_REACH = 3;
/** How many times smaller the columns' squared spread must be leaning than standing: half the scatter. */
const LEAN_CONTRAST = 4;

export interface EstimateSkewOptions {
  /** See {@link LinesFromWordsOptions.lineTolerance}. Default 0.5. */
  readonly lineTolerance?: number;
  /** Steepest tilt to consider, in degrees. Default 5. */
  readonly maxDegrees?: number;
}

/**
 * The angle a page's text lines are turned by, measured from the words alone, in
 * radians with the sign {@link LinesFromWordsOptions.skew} uses. 0 when words line up
 * side by side upright and no other angle in range lines them up clearly better.
 * `undefined` when the words give no evidence either way: too few of them, none side by
 * side at any angle, or a better angle that the page does not bear out, such as one
 * that only joins the rows of two columns.
 *
 * Projection-profile skew detection on word centres: the angle at which the most
 * centres share a band is the angle of the lines. Only pairs of words that do not
 * overlap horizontally count, because two words on one line never do. That keeps a
 * column of table cells, or a stack of whole-line regions, from lining up at whatever
 * angle joins one row to the next.
 *
 * Two columns line up at some angle by chance: one whose rows sit half a line below
 * the other's join row for row at the angle that crosses that half line over the gutter.
 * So the page must also bear the angle out where its words are certainly on one line.
 */
export function estimateSkew(words: readonly PositionedWord[], options: EstimateSkewOptions = {}): number | undefined {
  const boxes = words.map(({ box: [xMin, yMin, xMax, yMax] }) => ({ x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin }));
  return skewOf(boxes, options.lineTolerance ?? 0.5, options.maxDegrees ?? MAX_SKEW_DEGREES);
}

type Box = Pick<TextSpan, "x" | "y" | "width" | "height">;

const centreX = (box: Box): number => box.x + box.width / 2;
const centreY = (box: Box): number => box.y + box.height / 2;

function overlapping(a: Box, b: Box): boolean {
  return b.x < a.x + a.width && a.x < b.x + b.width;
}

function skewOf(boxes: readonly Box[], tolerance: number, maxDegrees: number): number | undefined {
  const height = median(boxes.map((box) => box.height).filter((value) => value > 0));
  const band = height * tolerance;
  if (boxes.length < 3 || !(band > 0)) return undefined;
  const alignment = (degrees: number): number => {
    const slope = Math.tan((degrees * Math.PI) / 180);
    const placed = boxes
      .map((box) => ({ box, across: centreY(box) - slope * centreX(box) }))
      .sort((a, b) => a.across - b.across);
    let score = 0;
    for (let i = 0; i < placed.length; i += 1) {
      const { box, across } = placed[i]!;
      for (let j = i + 1; j < placed.length && placed[j]!.across - across < band; j += 1) {
        const other = placed[j]!;
        if (!overlapping(box, other.box)) score += 1 - (other.across - across) / band;
      }
    }
    return score;
  };
  const upright = alignment(0);
  const fallback = upright > 0 ? 0 : undefined;
  if (!(maxDegrees > 0)) return fallback;
  let best = { degrees: 0, score: upright };
  const search = (from: number, to: number, step: number): void => {
    for (let index = 0; from + index * step <= to + step / 2; index += 1) {
      const degrees = from + index * step;
      const score = alignment(degrees);
      if (score > best.score) best = { degrees, score };
    }
  };
  search(-maxDegrees, maxDegrees, Math.min(SKEW_STEP_DEGREES, maxDegrees));
  search(Math.max(-maxDegrees, best.degrees - SKEW_STEP_DEGREES), Math.min(maxDegrees, best.degrees + SKEW_STEP_DEGREES), SKEW_STEP_DEGREES / 10);
  if (best.degrees === 0 || !(best.score > upright * (1 + SKEW_MIN_GAIN))) return fallback;
  const radians = (best.degrees * Math.PI) / 180;
  return showsTilt(boxes, Math.tan(radians), band, height) ? radians : undefined;
}

/** Whether the page's lines, grouped along `slope`, bear out that slope. See {@link estimateSkew}. */
function showsTilt(boxes: readonly Box[], slope: number, band: number, height: number): boolean {
  const rows = bandLines(boxes, slope, band, () => false).map((row) => [...row].sort((a, b) => a.x - b.x));
  const phrases = rows.flatMap((row) => {
    const runs: Box[][] = [];
    for (const box of row) {
      const run = runs.at(-1);
      const last = run?.at(-1);
      if (run !== undefined && last !== undefined && box.x - (last.x + last.width) <= PHRASE_GAP * height && !overlapping(last, box)) run.push(box);
      else runs.push([box]);
    }
    return runs.filter((run) => run.length >= PHRASE_WORDS);
  });
  if (phrases.length >= PHRASES) {
    // One least-squares slope over all phrases, each about its own mean, so long phrases weigh most.
    let covariance = 0;
    let variance = 0;
    for (const phrase of phrases) {
      const meanX = phrase.reduce((sum, box) => sum + centreX(box), 0) / phrase.length;
      const meanY = phrase.reduce((sum, box) => sum + centreY(box), 0) / phrase.length;
      for (const box of phrase) {
        covariance += (centreX(box) - meanX) * (centreY(box) - meanY);
        variance += (centreX(box) - meanX) ** 2;
      }
    }
    const measured = variance > 0 ? covariance / variance : 0;
    return Math.abs(measured - slope) <= Math.max(PHRASE_AGREEMENT * Math.abs(slope), PHRASE_SLOPE_FLOOR);
  }
  // A tilt too slight to move a row's ends a band apart cannot pair rows the upright
  // bands keep apart, so it needs no more proof.
  const reach = Math.max(...rows.map((row) => centreX(row.at(-1)!) - centreX(row[0]!)));
  if (reach * Math.abs(slope) <= band) return true;
  const aligned = rows.filter((row) => {
    const separate = row.filter((box, index) => index === 0 || !overlapping(row[index - 1]!, box));
    const centres = separate.map(centreY);
    return separate.length >= 3 && Math.max(...centres) - Math.min(...centres) > band;
  });
  return aligned.length >= ALIGNED_ROWS || stackedTooClose(boxes) || columnsLean(boxes, slope, band, height);
}

/**
 * Whether the page's columns lean as far as its rows tilt. Turning a page turns its
 * columns with its rows: a column's edges drift left by the slope times their drop when
 * the rows descend to the right. The columns of an upright page stand straight, so this
 * tells a tilted table of two far-apart cells per row, which no other evidence covers,
 * from upright columns whose rows sit at staggered heights and line up at the same angle.
 */
function columnsLean(boxes: readonly Box[], slope: number, band: number, height: number): boolean {
  const byTop = [...boxes].sort((a, b) => centreY(a) - centreY(b));
  const below = new Map<Box, Box>();
  const claimed = new Set<Box>();
  byTop.forEach((box, index) => {
    for (let j = index + 1; j < byTop.length && centreY(byTop[j]!) - centreY(box) <= COLUMN_REACH * height; j += 1) {
      const next = byTop[j]!;
      if (!claimed.has(next) && Math.min(box.x + box.width, next.x + next.width) - Math.max(box.x, next.x) > Math.min(box.width, next.width) / 2) {
        below.set(box, next);
        claimed.add(next);
        return;
      }
    }
  });
  const edges = [(box: Box) => box.x, centreX, (box: Box) => box.x + box.width];
  // Squared spread of the column's best-aligned edge with the column turned upright by `lean`.
  const spread = (column: readonly Box[], lean: number): number => Math.min(...edges.map((edge) => {
    const offsets = column.map((box) => edge(box) - lean * centreY(box));
    const mean = offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length;
    return offsets.reduce((sum, offset) => sum + (offset - mean) ** 2, 0);
  }));
  let [leaning, standing] = [0, 0];
  for (const top of byTop.filter((box) => !claimed.has(box))) {
    const column: Box[] = [];
    for (let box: Box | undefined = top; box !== undefined; box = below.get(box)) column.push(box);
    if (column.length < COLUMN_BOXES) continue;
    const [lean, straight] = [spread(column, -slope), spread(column, 0)];
    if (Math.min(lean, straight) > column.length * (band / 2) ** 2) continue;
    leaning += lean;
    standing += straight;
  }
  return standing > 0 && leaning * LEAN_CONTRAST <= standing;
}

/**
 * Whether the boxes of each column sit closer together than an upright page allows. A
 * line's box is about as tall as the line pitch upright, padding included, but a wide
 * line's box on a tilted page also spans its width times the slope, so the boxes of
 * consecutive lines overlap deeply.
 */
function stackedTooClose(boxes: readonly Box[]): boolean {
  const byTop = [...boxes].sort((a, b) => centreY(a) - centreY(b));
  // A box with no other within its own height below it counts as far from the next line.
  const ratios = byTop.map((box, index) => {
    for (let j = index + 1; j < byTop.length && centreY(byTop[j]!) - centreY(box) <= box.height; j += 1) {
      const below = byTop[j]!;
      if (Math.min(box.x + box.width, below.x + below.width) - Math.max(box.x, below.x) > Math.min(box.width, below.width) / 2) {
        return (centreY(below) - centreY(box)) / ((box.height + below.height) / 2);
      }
    }
    return Infinity;
  });
  return median(ratios) < STACKED_PITCH;
}

/**
 * Greedy banding of boxes along `slope`, in order down the page. `runningCentre` tracks
 * the mean of the line so far, so a line that drifts follows its own words rather than
 * the first one. A box `apart` from one already on the line starts the next line.
 */
function bandLines<T extends Box>(boxes: readonly T[], slope: number, band: number, apart: (line: readonly T[], box: T) => boolean): T[][] {
  // Measured across the page's lines, so a tilted row stays at one height.
  const centre = (box: Box): number => centreY(box) - slope * centreX(box);
  const byVertical = [...boxes].sort((a, b) => centre(a) - centre(b) || a.x - b.x);
  const groups: T[][] = [];
  let current: T[] = [];
  let runningCentre = 0;
  for (const box of byVertical) {
    if (current.length > 0 && Math.abs(centre(box) - runningCentre) <= band && !apart(current, box)) {
      current.push(box);
      runningCentre += (centre(box) - runningCentre) / current.length;
    } else {
      if (current.length > 0) groups.push(current);
      current = [box];
      runningCentre = centre(box);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function rotatedLines(spans: readonly TextSpan[], tolerance: number): TextLine[] {
  const placed = spans.map((span) => {
    const angle = ((span.rotation ?? 0) * Math.PI) / 180;
    const [cx, cy] = [span.x + span.width / 2, span.y + span.height / 2];
    return {
      span,
      along: cx * Math.cos(angle) - cy * Math.sin(angle),
      across: cx * Math.sin(angle) + cy * Math.cos(angle),
      size: span.style?.fontSize ?? Math.min(span.width, span.height),
    };
  }).sort((a, b) => (a.span.rotation ?? 0) - (b.span.rotation ?? 0) || a.across - b.across);
  const groups: (typeof placed)[] = [];
  for (const item of placed) {
    const current = groups.at(-1);
    const last = current?.at(-1);
    if (current !== undefined && last !== undefined && last.span.rotation === item.span.rotation &&
      Math.abs(item.across - last.across) <= Math.max(item.size, last.size) * tolerance) current.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.along - b.along).map((item) => item.span);
    const top = Math.min(...ordered.map((s) => s.y));
    const bottom = Math.max(...ordered.map((s) => s.y + s.height));
    return { y: top, height: bottom - top, text: ordered.map((s) => s.text.trim()).join(" "), spans: ordered };
  });
}

/**
 * Smallest text size, against the larger, and offset, in bands or in lines of that text,
 * at which a box over one on the line is the next line. See `horizontalLines`.
 */
const STACKED_SIZE = 0.75;
const STACKED_OFFSET = 0.75;

function horizontalLines(spans: readonly TextSpan[], tolerance: number, slope: number): TextLine[] {
  if (spans.length === 0) return [];
  const heights = spans.map((s) => s.height).filter((h) => h > 0);
  // Fall back to a sane body-text height when every box is degenerate.
  const band = (median(heights) || 10) * tolerance;

  // On a tilted page a wide box is taller than its text by its width times the slope,
  // so the band can reach the next line. A box that mostly shares its width with one on
  // the line, sets text of about its size, and sits nearly a band or a line of that text
  // above or below it is that next line. A raised mark, a fraction part, or a second box
  // OCR reports for one word is smaller or closer, and stays.
  const across = (s: TextSpan): number => s.y + s.height / 2 - slope * (s.x + s.width / 2);
  // A box no taller than its tilt adds has no measurable text height left; its own height stands in.
  const size = (s: TextSpan): number => {
    const upright = s.height - s.width * Math.abs(slope);
    return s.style?.fontSize ?? (upright > 0 ? upright : s.height);
  };
  const stacked = (line: readonly TextSpan[], span: TextSpan): boolean =>
    slope !== 0 && line.some((other) => {
      const [smaller, larger] = [Math.min(size(other), size(span)), Math.max(size(other), size(span))];
      return Math.min(other.x + other.width, span.x + span.width) - Math.max(other.x, span.x) > Math.min(other.width, span.width) / 2 &&
        smaller >= STACKED_SIZE * larger &&
        Math.abs(across(other) - across(span)) > STACKED_OFFSET * Math.min(band, larger);
    });

  return bandLines(spans, slope, band, stacked)
    .map((group) => {
      const ordered = readingOrderSpans(group);
      const top = Math.min(...ordered.map((s) => s.y));
      const bottom = Math.max(...ordered.map((s) => s.y + s.height));
      const line: TextLine = { y: top, height: bottom - top, text: joinSpans(ordered), spans: ordered };
      return { line, order: Math.min(...ordered.map((s) => s.y - slope * (s.x + s.width / 2))) };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ line }) => line);
}

/** Page text from its lines, in reading order. */
export function textFromLines(lines: readonly TextLine[]): string {
  return lines.map((l) => l.text).join("\n");
}
