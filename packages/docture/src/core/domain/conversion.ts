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

export type ConversionFormat = "text" | "markdown" | "html";
export type ConversionAssetMode = "referenced" | "embedded" | "omit";

export interface ElementProvenance {
  readonly pageNumber: number;
  readonly box: LayoutBox;
  /** Stable ids of the loader blocks or lines this element came from. */
  readonly sourceIds: readonly string[];
}

export interface InlineText {
  readonly text: string;
  readonly href?: string;
}

interface ElementBase {
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

export interface TableElement extends ElementBase {
  readonly kind: "table";
  readonly rows: readonly (readonly string[])[];
  readonly headerRows: number;
  /** Original loader line text, retained for exact TXT output. */
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

export type DocumentElement =
  | HeadingElement
  | ParagraphElement
  | CodeElement
  | ListElement
  | TableElement
  | FigureElement
  | PageBreakElement;

/** The reusable, exporter-independent result of layout analysis. */
export interface LayoutPage {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly elements: readonly DocumentElement[];
}

export interface LayoutDocument {
  readonly pages: readonly LayoutPage[];
  readonly metadata?: DocumentMetadata;
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
  readonly pageNumber?: number;
}

export interface ConversionAsset extends LoadedAsset {
  /** Relative target used by referenced Markdown and HTML. */
  readonly reference: string;
}

export interface ConvertedPage {
  readonly pageNumber: number;
  /** A format-specific fragment without the whole-document wrapper. */
  readonly content: string;
  readonly elements: readonly DocumentElement[];
}

export interface ConvertOptions {
  /** Default `"markdown"`. */
  readonly format?: ConversionFormat;
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
  readonly mimeType: "text/plain" | "text/markdown" | "text/html";
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
