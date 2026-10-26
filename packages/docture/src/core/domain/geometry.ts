/**
 * Positioned text — the shape every loader normalizes to, and the shape every
 * deterministic parser reads.
 *
 * COORDINATES: PDF points, **top-left origin, y increasing downward**. Chosen
 * because that is what OCR engines report natively, so no loader has to flip an
 * axis and no parser has to ask which way is up.
 * `lines` is sorted top-to-bottom, which is ascending `y`.
 */

import type { DocumentForm } from "./document.js";
import type { RasterOptions } from "./raster.js";

/** An axis-aligned box in PDF points, using the same top-left origin as text. */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Typography a loader can recover without guessing. */
export interface TextStyle {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly monospace?: boolean;
  /** CSS hex colour when the loader reports one. */
  readonly color?: string;
}

/** One run of text with a known position. */
export interface TextSpan {
  readonly text: string;
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 0–1 where the producer reports one (OCR does; a text layer does not). */
  readonly confidence?: number;
  readonly direction?: "ltr" | "rtl" | "ttb";
  readonly style?: TextStyle;
  /** Authored link target intersecting this span. */
  readonly href?: string;
}

/** Spans that sit on the same visual line, left-to-right. */
export interface TextLine {
  /** Top edge of the line box. */
  readonly y: number;
  readonly height: number;
  /** Span texts joined with single spaces. */
  readonly text: string;
  readonly spans: readonly TextSpan[];
}

/** A semantic hint from a tagged document. The analyzer may refine or ignore it. */
export type LayoutRoleHint =
  | "heading"
  | "paragraph"
  | "list-item"
  | "table"
  | "code"
  | "figure"
  | "header"
  | "footer";

export interface TextLayoutBlock extends LayoutBox {
  readonly id: string;
  readonly kind: "text";
  readonly lines: readonly TextLine[];
  readonly role?: LayoutRoleHint;
  /** 1–6 when a tagged PDF names the heading level. */
  readonly level?: number;
}

export interface ImageLayoutBlock extends LayoutBox {
  readonly id: string;
  readonly kind: "image";
  readonly assetId: string;
  readonly alt?: string;
}

export type LayoutBlock = TextLayoutBlock | ImageLayoutBlock;

/** An embedded raster figure copied out before the document engine is released. */
export interface LoadedAsset extends LayoutBox {
  readonly id: string;
  readonly pageNumber: number;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly alt?: string;
}

export interface DocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: readonly string[];
  readonly language?: string;
}

export interface LoadedPage {
  /** 1-based, in document order. */
  readonly pageNumber: number;
  /** Page width in PDF points. */
  readonly width: number;
  readonly height: number;
  /** The page's text. Empty string for a page with no text layer. */
  readonly text: string;
  /** Positioned geometry, when the loader produces it. */
  readonly lines?: readonly TextLine[];
  /** Reading-order candidates and figures, requested by document conversion. */
  readonly blocks?: readonly LayoutBlock[];
  /** Embedded figures used by the blocks above. */
  readonly assets?: readonly LoadedAsset[];
  /**
   * Rasterize THIS page, on demand.
   *
   * Lazy by design: a document may be 200 pages and a strategy may look at two of
   * them. Rendering the whole document up front would pay for all 200; this renders
   * what is asked for and nothing else.
   *
   * Returns encoded image bytes. For PNG or JPEG source images, a loader may
   * return the original bytes unchanged and ignore format, dpi, and maxEdge.
   * The returned encoding can therefore differ from the requested format.
   * Consumers must identify the actual media type from the bytes. A strict
   * image-size limit requires an explicit resize step for such inputs.
   */
  readonly image?: (opts?: RasterOptions) => Promise<Uint8Array>;
}

export interface LoadedDocument {
  readonly pages: readonly LoadedPage[];
  /** Whole-document text, pages joined by a form feed. */
  readonly text: string;
  readonly form: DocumentForm;
  /** Which loader produced this. Shows up in `result.attempts`. */
  readonly loader: string;
  readonly metadata?: DocumentMetadata;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * A document that has already been read, offered as a source.
 *
 * Two callers need this. `Process` re-extracts a page range it has already parsed
 * and must not pay to parse it again — ExtractThinker's `set_skip_loading` plus
 * `DocumentLoaderData`, expressed as a type instead of a mutable flag. And anyone
 * who has their own parser can hand its output straight in.
 *
 * The load stage is skipped entirely, so no loader is consulted and no bytes are
 * read: `capabilities` cannot be asked for, which is why this carries the
 * capability facts itself.
 */
export interface LoadedSource {
  readonly loaded: LoadedDocument;
  /** Reported as `features.mimeType`. Default `"application/octet-stream"`. */
  readonly mimeType?: string;
  readonly fileName?: string;
  /**
   * Facts to publish about this document, for strategy eligibility. Text and
   * geometry are derived from the pages; this is for anything else a custom
   * strategy requires.
   */
  readonly facts?: readonly string[];
}
