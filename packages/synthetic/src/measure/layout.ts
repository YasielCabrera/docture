import { silentLogger, type LayoutBox, type TextLine, type TextSpan } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import type { SyntheticDocument } from "../document.js";

/** One run of text: spans on a visual line with no gap wider than their font size. */
export interface MeasuredLine {
  readonly text: string;
  /**
   * Points, top-left origin, y down. Like every box Docture's PDF.js loader reports, it reaches from
   * the baseline up one font size, so the baseline is `box.y + box.height`.
   */
  readonly box: LayoutBox;
}

export interface MeasuredPage {
  readonly pageNumber: number;
  /** Points. */
  readonly width: number;
  readonly height: number;
  /** Top to bottom, then left to right. */
  readonly lines: readonly MeasuredLine[];
}

/** The text lines of a PDF with their boxes, page by page. */
export interface Measurement {
  readonly pages: readonly MeasuredPage[];
}

/** PDF bytes, a rendered PDF document, or a measurement taken earlier. */
export type LayoutSource = Uint8Array | Pick<SyntheticDocument, "bytes" | "mimeType"> | Measurement;

export interface CompareOptions {
  /** Points a matched line may drift before the comparison fails. Default 0.5. */
  readonly tolerance?: number;
}

export interface PlacedLine extends MeasuredLine {
  readonly pageNumber: number;
}

/** A line whose text occurs exactly once on its page in both documents. */
export interface LineDrift {
  readonly pageNumber: number;
  readonly text: string;
  readonly reference: LayoutBox;
  readonly candidate: LayoutBox;
  /** Candidate minus reference, in points. */
  readonly dx: number;
  readonly dy: number;
  /** The larger of `|dx|` and `|dy|`. */
  readonly drift: number;
}

/** Text on a page of both documents that occurs more than once on either, so it cannot be paired. */
export interface RepeatedLine {
  readonly pageNumber: number;
  readonly text: string;
  /** Occurrences on the page of each document. */
  readonly reference: number;
  readonly candidate: number;
}

export interface LayoutComparison {
  /** `maxDrift` is within `tolerance`. */
  readonly ok: boolean;
  readonly tolerance: number;
  /** The largest `drift` of a matched line; 0 when nothing matched. */
  readonly maxDrift: number;
  readonly matched: readonly LineDrift[];
  /** Lines whose text the same page of the candidate never shows. */
  readonly onlyInReference: readonly PlacedLine[];
  readonly onlyInCandidate: readonly PlacedLine[];
  readonly repeated: readonly RepeatedLine[];
}

/** Read every text line of a PDF with its box through PDF.js. Needs `pdfjs-dist` through `docture/loaders/pdfjs`. */
export async function measurePdf(bytes: Uint8Array): Promise<Measurement> {
  const loaded = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, { signal: new AbortController().signal, logger: silentLogger });
  return {
    pages: loaded.pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      lines: (page.lines ?? []).flatMap(runsOf).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x),
    })),
  };
}

/**
 * Measure how far the text of `candidate` sits from the same text in `reference`. Only text that occurs
 * exactly once on a page of both documents is paired, by its whitespace-collapsed content; repeated
 * text would pair by guesswork. Every list is in page order, then top to bottom and left to right.
 */
export async function compareLayouts(reference: LayoutSource, candidate: LayoutSource, options: CompareOptions = {}): Promise<LayoutComparison> {
  const tolerance = options.tolerance ?? 0.5;
  const [before, after] = await Promise.all([measurementOf(reference), measurementOf(candidate)]);
  const left = byPageAndText(before);
  const right = byPageAndText(after);
  const matched: [first: PlacedLine, line: LineDrift][] = [];
  const onlyInReference: PlacedLine[] = [];
  const onlyInCandidate: PlacedLine[] = [];
  const repeated: [first: PlacedLine, line: RepeatedLine][] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const ours = left.get(key) ?? [];
    const theirs = right.get(key) ?? [];
    const [one] = ours;
    const [other] = theirs;
    if (other === undefined) onlyInReference.push(...ours);
    else if (one === undefined) onlyInCandidate.push(...theirs);
    else if (ours.length > 1 || theirs.length > 1) {
      repeated.push([one, { pageNumber: one.pageNumber, text: one.text, reference: ours.length, candidate: theirs.length }]);
    } else {
      const dx = other.box.x - one.box.x;
      const dy = other.box.y - one.box.y;
      matched.push([one, { pageNumber: one.pageNumber, text: one.text, reference: one.box, candidate: other.box, dx, dy, drift: Math.max(Math.abs(dx), Math.abs(dy)) }]);
    }
  }
  const maxDrift = matched.reduce((worst, [, line]) => Math.max(worst, line.drift), 0);
  return {
    ok: maxDrift <= tolerance,
    tolerance,
    maxDrift,
    matched: byFirst(matched),
    onlyInReference: onlyInReference.sort(inReadingOrder),
    onlyInCandidate: onlyInCandidate.sort(inReadingOrder),
    repeated: byFirst(repeated),
  };
}

async function measurementOf(source: LayoutSource): Promise<Measurement> {
  if (source instanceof Uint8Array) return measurePdf(source);
  if (!("bytes" in source)) return source;
  if (source.mimeType !== "application/pdf") {
    throw new RangeError(`compareLayouts reads the text layer of a PDF; a "${source.mimeType}" document has none`);
  }
  return measurePdf(source.bytes);
}

function byPageAndText(measurement: Measurement): Map<string, PlacedLine[]> {
  const lines = new Map<string, PlacedLine[]>();
  for (const page of measurement.pages) {
    for (const line of page.lines) {
      const text = normalize(line.text);
      if (text === "") continue;
      const key = `${page.pageNumber}\n${text}`;
      const placed = lines.get(key) ?? [];
      placed.push({ pageNumber: page.pageNumber, text, box: line.box });
      lines.set(key, placed);
    }
  }
  return lines;
}

// Docture bands every span at one height into a line across the whole page; a gap wider than the
// font size separates columns, a label from its value, the way pdftotext splits lines into blocks.
function runsOf(line: TextLine): MeasuredLine[] {
  const runs: TextSpan[][] = [];
  for (const span of line.spans) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run !== undefined && last !== undefined && span.x - (last.x + last.width) <= Math.max(last.height, span.height)) run.push(span);
    else runs.push([span]);
  }
  return runs.map((run) => {
    const x = Math.min(...run.map((span) => span.x));
    const y = Math.min(...run.map((span) => span.y));
    const right = Math.max(...run.map((span) => span.x + span.width));
    const bottom = Math.max(...run.map((span) => span.y + span.height));
    // Touching spans are pieces of one word; only a visible gap is a space.
    const text = run.map((span, i) => (i > 0 && span.x - (run[i - 1]!.x + run[i - 1]!.width) > span.height * 0.15 ? ` ${span.text}` : span.text)).join("");
    return { text: normalize(text), box: { x, y, width: right - x, height: bottom - y } };
  });
}

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function byFirst<T>(pairs: [first: PlacedLine, line: T][]): T[] {
  return pairs.sort(([a], [b]) => inReadingOrder(a, b)).map(([, line]) => line);
}

function inReadingOrder(a: PlacedLine, b: PlacedLine): number {
  return a.pageNumber - b.pageNumber || a.box.y - b.box.y || a.box.x - b.box.x || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
}
