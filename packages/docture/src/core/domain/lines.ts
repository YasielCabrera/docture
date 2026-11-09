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
  const rotated = spans.filter(isTurned);
  if (rotated.length > 0) {
    const horizontal = spans.filter((span) => !isTurned(span));
    return [...horizontalLines(horizontal, tolerance), ...rotatedLines(rotated, tolerance)].sort((a, b) => a.y - b.y);
  }
  return horizontalLines(spans, tolerance);
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

function horizontalLines(spans: readonly TextSpan[], tolerance: number): TextLine[] {
  if (spans.length === 0) return [];
  const heights = spans.map((s) => s.height).filter((h) => h > 0);
  // Fall back to a sane body-text height when every box is degenerate.
  const bandHeight = median(heights) || 10;
  const band = bandHeight * tolerance;

  const centre = (s: TextSpan): number => s.y + s.height / 2;
  const byVertical = [...spans].sort((a, b) => centre(a) - centre(b) || a.x - b.x);

  // Greedy banding. `runningCentre` tracks the mean of the line so far, so a line
  // that drifts (a rotated scan) follows its own words rather than the first one.
  const groups: TextSpan[][] = [];
  let current: TextSpan[] = [];
  let runningCentre = 0;

  for (const span of byVertical) {
    if (current.length === 0) {
      current = [span];
      runningCentre = centre(span);
      continue;
    }
    if (Math.abs(centre(span) - runningCentre) <= band) {
      current.push(span);
      runningCentre += (centre(span) - runningCentre) / current.length;
    } else {
      groups.push(current);
      current = [span];
      runningCentre = centre(span);
    }
  }
  if (current.length > 0) groups.push(current);

  return groups
    .map((group): TextLine => {
      const ordered = readingOrderSpans(group);
      const top = Math.min(...ordered.map((s) => s.y));
      const bottom = Math.max(...ordered.map((s) => s.y + s.height));
      return {
        y: top,
        height: bottom - top,
        text: joinSpans(ordered),
        spans: ordered,
      };
    })
    .sort((a, b) => a.y - b.y);
}

/** Page text from its lines, in reading order. */
export function textFromLines(lines: readonly TextLine[]): string {
  return lines.map((l) => l.text).join("\n");
}
