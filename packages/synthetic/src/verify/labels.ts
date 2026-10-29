import { silentLogger, type LoadedPage, type LayoutBox } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import type { FieldLabel, SyntheticDocument } from "../document.js";
import { LabelVerificationError, type LabelFailure } from "../errors.js";

export interface VerifyOptions {
  /** Points a label box grows on each side before text spans are matched against it. Default 2. */
  readonly tolerance?: number;
}

/** What verification reads: a digital rendition's bytes and its labels. */
export type VerifiableDocument = Pick<SyntheticDocument, "bytes" | "mimeType" | "labels" | "rendition">;

export interface VerificationReport {
  readonly ok: boolean;
  /** Labels checked. */
  readonly checked: number;
  readonly failures: readonly LabelFailure[];
}

/**
 * Read a digital rendition back through PDF.js and confirm every label: its box lies on the page,
 * and the text spans meeting the box show the label's text. Other renditions have no text layer and
 * throw `RangeError`.
 */
export async function verifyLabels(document: VerifiableDocument, options: VerifyOptions = {}): Promise<VerificationReport> {
  if (document.rendition.kind !== "digital") {
    throw new RangeError(`verifyLabels reads the text layer of a digital rendition; a "${document.rendition.kind}" rendition has none`);
  }
  const tolerance = options.tolerance ?? 2;
  const loaded = await new DocumentLoaderPdfJs().load(
    { bytes: document.bytes, mimeType: document.mimeType },
    { signal: new AbortController().signal, logger: silentLogger },
  );
  const pages = new Map(loaded.pages.map((page) => [page.pageNumber, page]));
  const failures = document.labels.flatMap((label) => {
    const failure = checkLabel(label, pages.get(label.pageNumber), tolerance);
    return failure === undefined ? [] : [failure];
  });
  return { ok: failures.length === 0, checked: document.labels.length, failures };
}

/** `verifyLabels`, failing with `LabelVerificationError` that lists every failed label. */
export async function assertVerified(document: VerifiableDocument, options: VerifyOptions = {}): Promise<void> {
  const report = await verifyLabels(document, options);
  if (!report.ok) throw new LabelVerificationError(report.failures);
}

function checkLabel(label: FieldLabel, page: LoadedPage | undefined, tolerance: number): LabelFailure | undefined {
  const fail = (kind: LabelFailure["kind"], message: string): LabelFailure => ({ path: label.path, kind, pageNumber: label.pageNumber, message });
  if (page === undefined) return fail("missing", `page ${label.pageNumber} does not exist`);
  const { box } = label;
  if (box.x < 0 || box.y < 0 || box.x + box.width > page.width || box.y + box.height > page.height) {
    return fail("page-overflow", `box ${describe(box)} leaves the ${round(page.width)} × ${round(page.height)} page`);
  }
  const wanted = normalize(label.text);
  const spans = (page.lines ?? []).flatMap((line) => line.spans);
  const grown = { x: box.x - tolerance, y: box.y - tolerance, width: box.width + tolerance * 2, height: box.height + tolerance * 2 };
  const inside = spans.filter((span) => intersects(span, grown)).map((span) => span.text);
  if (normalize(inside.join(" ")).includes(wanted)) return undefined;
  // Letter-spaced text reads back with spaces between glyphs, often as several spans. Compared
  // without whitespace, only spans centred in the box count, so neighbours cannot complete the text.
  const centred = spans.filter((span) => contains(grown, span.x + span.width / 2, span.y + span.height / 2)).map((span) => span.text);
  if (shows(centred, wanted)) return undefined;
  // Reading order interleaves neighbouring columns, so the page-wide search only names the failure.
  return shows(spans.map((span) => span.text), wanted)
    ? fail("outside-box", `"${label.text}" is on page ${label.pageNumber}, but not inside ${describe(box)}`)
    : fail("missing", `"${label.text}" is not on page ${label.pageNumber}`);
}

/** Whether the spans show `wanted`, read in order, with whitespace ignored as a fallback for letter-spaced text. */
function shows(spans: readonly string[], wanted: string): boolean {
  if (normalize(spans.join(" ")).includes(wanted)) return true;
  const condensed = wanted.replace(/\s/gu, "");
  return spans.join("").replace(/\s/gu, "").includes(condensed);
}

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function contains(box: LayoutBox, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function intersects(a: LayoutBox, b: LayoutBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const round = (value: number): number => Math.round(value * 100) / 100;

function describe(box: LayoutBox): string {
  return `[${round(box.x)}, ${round(box.y)}, ${round(box.width)} × ${round(box.height)}]`;
}
