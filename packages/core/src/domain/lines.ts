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
  readonly style?: TextStyle;
  readonly href?: string;
}

export interface LinesFromWordsOptions {
  /**
   * Multiplied into every coordinate. An OCR engine working on a 300-DPI raster
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

/** Median of a non-empty numeric array. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Group words into visual lines, sorted top-to-bottom with each line's spans
 * sorted left-to-right.
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
        ...(w.style === undefined ? {} : { style: w.style }),
        ...(w.href === undefined ? {} : { href: w.href }),
      };
      return span;
    });

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
      const ordered = [...group].sort((a, b) => a.x - b.x);
      const top = Math.min(...ordered.map((s) => s.y));
      const bottom = Math.max(...ordered.map((s) => s.y + s.height));
      return {
        y: top,
        height: bottom - top,
        text: ordered.map((s) => s.text).join(" "),
        spans: ordered,
      };
    })
    .sort((a, b) => a.y - b.y);
}

/** Page text from its lines, in reading order. */
export function textFromLines(lines: readonly TextLine[]): string {
  return lines.map((l) => l.text).join("\n");
}
