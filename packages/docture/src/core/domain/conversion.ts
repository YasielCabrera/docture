/**
 * The normalized document produced by conversion.
 *
 * Loaders report facts and geometry. The deterministic analyzer turns those facts
 * into these elements, and every exporter reads the same shape. That keeps TXT,
 * Markdown and HTML from developing three different ideas of reading order.
 */

import type { DocumentFeatures } from "./document.js";
import type { DocumentMetadata, LayoutBox, LoadedAsset } from "./geometry.js";
import type { Attempt, Usage } from "./result.js";
import type { SourceEvidence } from "./evidence.js";

export type ConversionFormat = "text" | "markdown" | "html" | "json";
export type ConversionAssetMode = "referenced" | "embedded" | "omit";

/** Canonical id of one positioned loader line: `p<page>-line-<1-based index into page.lines>`. */
export type LineSourceId = `p${number}-line-${number}`;

/** One positioned line of a loaded page, addressable by its canonical id. */
export interface SourceLine {
  readonly id: LineSourceId;
  readonly pageNumber: number;
  /** Union of the line's spans; `{ x: 0, y, width: 0, height }` when it has none. */
  readonly box: LayoutBox;
  /** The loader's `TextLine.text`, verbatim. */
  readonly text: string;
}

/** One page's share of an element's source. */
export interface ProvenanceSegment {
  /** @integer @minimum 1 */
  readonly pageNumber: number;
  readonly box: LayoutBox;
  /** Stable ids of the loader blocks or lines this element came from. */
  readonly sourceIds: readonly string[];
  /**
   * Canonical ids of the positioned lines this element came from, in source order.
   * Absent when the page has no positioned lines.
   * @minItems 1
   * @pattern ^p[1-9]\d*-line-[1-9]\d*$
   */
  readonly lineIds?: readonly LineSourceId[];
}

/**
 * Where an element came from. The segment fields describe the page where the
 * element starts; read every page's share with `provenanceSegments`.
 */
export interface ElementProvenance extends ProvenanceSegment {
  /**
   * The later pages a table or paragraph continues onto, one segment per page in
   * page order, starting with the next page. Absent when the element is page-local.
   * @minItems 1
   */
  readonly continuations?: readonly ProvenanceSegment[];
}

export interface InlineText {
  readonly text: string;
  readonly href?: string;
}

interface ElementBase {
  /**
   * Unique within the document. Conversion derives it from the element's content and
   * position: `p<page>-` and 12 hex characters of a SHA-256 digest over the identity
   * class (`text` for headings, paragraphs, code and furniture), the page, the start
   * page's rounded left and top position, and the whitespace-normalized content. An exact
   * duplicate gets `-2`, `-3`, ... in document order; a page break is `p<page>-page-break`.
   * Reflow, segmentation or loader changes alter it. It is an anchor, not a checksum.
   */
  readonly id: string;
  readonly provenance: ElementProvenance;
}

export interface HeadingElement extends ElementBase {
  readonly kind: "heading";
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly runs: readonly InlineText[];
}

export interface ParagraphElement extends ElementBase {
  readonly kind: "paragraph";
  readonly text: string;
  readonly runs: readonly InlineText[];
}

export interface CodeElement extends ElementBase {
  readonly kind: "code";
  readonly text: string;
}

export interface ListElement extends ElementBase {
  readonly kind: "list";
  readonly ordered: boolean;
  readonly items: readonly {
    readonly text: string;
    readonly runs: readonly InlineText[];
    /** Original presentation marker, retained for exact TXT output. */
    readonly marker?: string;
  }[];
}

/**
 * A merged table cell. Its text sits in the anchor slot `rows[row][col]`; every
 * other slot it covers holds `""`. A span never crosses the `headerRows` boundary.
 */
export interface TableCellSpan {
  /** Zero-based anchor row. @integer @minimum 0 */
  readonly row: number;
  /** Zero-based anchor column. @integer @minimum 0 */
  readonly col: number;
  /** @integer @minimum 1 */
  readonly rowSpan: number;
  /** @integer @minimum 1 */
  readonly colSpan: number;
}

export interface TableElement extends ElementBase {
  readonly kind: "table";
  /** Every row has one slot per column when `spans` is present. */
  readonly rows: readonly (readonly string[])[];
  /** Leading rows that label columns, from 0 to `rows.length`. @integer @minimum 0 */
  readonly headerRows: number;
  /**
   * Merged cells, sorted by row and then column. Absent when every cell is 1x1.
   * @minItems 1
   */
  readonly spans?: readonly TableCellSpan[];
  /**
   * One segment per row, index-aligned with `rows`: the page, box and source of
   * the line each row came from. Present on tables built from positioned lines.
   * @minItems 1
   */
  readonly rowProvenance?: readonly ProvenanceSegment[];
  /**
   * Original loader line text, retained for exact TXT output. It includes a header
   * row repeated at the top of a continuation page, which `rows` drops.
   */
  readonly sourceText?: string;
}

export interface FigureElement extends ElementBase {
  readonly kind: "figure";
  readonly assetId: string;
  readonly alt?: string;
  readonly caption?: string;
}

export interface PageBreakElement extends ElementBase {
  readonly kind: "page-break";
}

/**
 * Where page furniture came from. `tagged`: the loader's structure tag said so.
 * `repeated`: inferred from text repeated in the top or bottom band of several pages.
 */
export type FurnitureEvidence = "tagged" | "repeated";

/** A running header. Markdown and HTML omit it; TXT and JSON keep it. */
export interface PageHeaderElement extends ElementBase {
  readonly kind: "page-header";
  readonly text: string;
  readonly runs: readonly InlineText[];
  readonly evidence: FurnitureEvidence;
}

/** A running footer, such as a page number. Markdown and HTML omit it; TXT and JSON keep it. */
export interface PageFooterElement extends ElementBase {
  readonly kind: "page-footer";
  readonly text: string;
  readonly runs: readonly InlineText[];
  readonly evidence: FurnitureEvidence;
}

export type DocumentElement =
  | HeadingElement
  | ParagraphElement
  | CodeElement
  | ListElement
  | TableElement
  | FigureElement
  | PageBreakElement
  | PageHeaderElement
  | PageFooterElement;

/** The reusable, exporter-independent result of layout analysis. */
export interface LayoutPage {
  readonly evidence?: readonly SourceEvidence[];
  /** @integer @minimum 1 */
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly elements: readonly DocumentElement[];
}

export interface LayoutDocument {
  readonly physicalSourceDigest?: string;
  readonly sourceDigest?: string;
  readonly pages: readonly LayoutPage[];
  readonly metadata?: DocumentMetadata;
}

export type DoctureDocumentAsset =
  | { readonly id: string; readonly mimeType: string; readonly reference: string; readonly data?: never }
  | { readonly id: string; readonly mimeType: string; readonly data: string; readonly reference?: never };

/**
 * Portable conversion snapshot. Breaking shape changes require a new schema version.
 * Read a saved snapshot with `parseDoctureDocument`, which also accepts version 1.
 */
export interface DoctureDocument {
  readonly physicalSourceDigest?: string;
  readonly sourceDigest?: string;
  readonly schemaVersion: 2;
  readonly loader: string;
  readonly method: string;
  readonly pages: readonly LayoutPage[];
  readonly assets: readonly DoctureDocumentAsset[];
  readonly warnings: readonly ConversionWarning[];
}

export type ConversionWarningCode =
  | "LAYOUT_DEGRADED"
  | "AMBIGUOUS_READING_ORDER"
  | "UNSUPPORTED_ASSET"
  | "UNSAFE_LINK"
  | "LAYOUT_ANALYZER_FAILED"
  | "INVALID_LAYOUT_ANALYSIS";

export interface ConversionWarning {
  readonly code: ConversionWarningCode;
  readonly message: string;
  /** @integer @minimum 1 */
  readonly pageNumber?: number;
}

export interface ConversionAsset extends LoadedAsset {
  /** Relative target used by referenced Markdown and HTML. */
  readonly reference: string;
}

export interface ConvertedPage {
  readonly evidence?: readonly SourceEvidence[];
  readonly pageNumber: number;
  /** Page width in PDF points, copied from the loaded page. */
  readonly width: number;
  readonly height: number;
  /**
   * A format-specific fragment without the whole-document wrapper. It holds every
   * element that starts on this page, including the rest of a table or paragraph
   * that continues onto later pages.
   */
  readonly content: string;
  readonly elements: readonly DocumentElement[];
}

export interface ConvertOptions {
  /** Default `"markdown"`. */
  readonly format?: ConversionFormat;
  /**
   * Original one-based page numbers to convert. Default: every page. Loaders that honor
   * page hints read only these pages, and the result keeps the original page numbers.
   * An empty selection or a page the document lacks raises `PAGE_OUT_OF_RANGE`.
   */
  readonly pages?: readonly number[];
  /** Default `"referenced"`. */
  readonly assets?: ConversionAssetMode;
  readonly signal?: AbortSignal;
  readonly logger?: import("./logger.js").Logger;
  /** Per-stage deadline in ms. Omit for none. */
  readonly stageTimeoutMs?: number;
}

export interface ConversionResult {
  readonly content: string;
  readonly format: ConversionFormat;
  readonly mimeType: "text/plain" | "text/markdown" | "text/html" | "application/json";
  readonly pages: readonly ConvertedPage[];
  readonly assets: readonly ConversionAsset[];
  readonly loader: string;
  /** `deterministic`, or `deterministic+<layout analyzer>`. */
  readonly method: string;
  readonly attempts: readonly Attempt[];
  readonly warnings: readonly ConversionWarning[];
  readonly features: DocumentFeatures;
  readonly usage: Usage;
}

export type SafeConversion =
  | { readonly ok: true; readonly result: ConversionResult }
  | { readonly ok: false; readonly error: Error };

export interface ConversionBatchOptions extends ConvertOptions {
  /** Documents processed at once. Default 4. */
  readonly concurrency?: number;
}

export interface ConversionBatchItem {
  readonly source: import("./document.js").DocumentSource;
  readonly index: number;
  readonly outcome: SafeConversion;
}
