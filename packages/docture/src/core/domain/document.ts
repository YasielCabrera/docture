/**
 * What a document IS, before anything has read it.
 *
 * This layer names things and depends on nothing — not on a PDF library, not on a
 * model, not on the filesystem.
 */

import type { LoadedSource } from "./geometry.js";

/** Bytes plus what little we know about them. What every loader is handed. */
export interface RawDocument {
  readonly bytes: Uint8Array;
  /** IANA media type. Sniffed from the bytes when the caller does not say. */
  readonly mimeType?: string;
  readonly fileName?: string;
}

/**
 * Anything you can extract from. A path or `file:` URL is read from disk, an
 * `http(s)` URL is fetched, bytes are used as-is, and a {@link LoadedSource} skips
 * the load stage because it has already been read.
 */
export type DocumentSource =
  | string
  | URL
  | Uint8Array
  | ArrayBuffer
  | RawDocument
  | LoadedSource;

/** True when the caller has already read the document and the load stage is moot. */
export function isLoadedSource(source: DocumentSource): source is LoadedSource {
  return typeof source === "object" && source !== null && "loaded" in source;
}

/**
 * Whether the pages carry their own text.
 *
 * - `digital` — every page has a usable text layer
 * - `scanned` — no page does; it is images all the way down
 * - `mixed`   — some do (a born-digital statement with a scanned annex)
 * - `unknown` — the loader cannot tell (it does not read text at all)
 */
export type DocumentForm = "digital" | "scanned" | "mixed" | "unknown";

/**
 * A fact about a document that a strategy can require. Open on purpose: a custom
 * strategy may require a fact this library never heard of, and
 * {@link DocumentFeatures.extra} is where a custom loader publishes it.
 */
export type KnownDocumentFact = "TEXT_LAYER" | "GEOMETRY" | "RENDERABLE_PAGES";
export type DocumentFact = KnownDocumentFact | (string & {});

/**
 * What a load actually found. Eligibility is decided against this, so a strategy
 * that cannot possibly work on this document never runs.
 */
export interface DocumentFeatures {
  readonly mimeType: string;
  readonly pageCount: number;
  /** Total characters of extracted text across all pages, trimmed. */
  readonly textLength: number;
  readonly hasTextLayer: boolean;
  /** Positioned word/line boxes are available, not just a text blob. */
  readonly hasGeometry: boolean;
  /** Pages can be rendered to images (for OCR or a vision model). */
  readonly hasRenderablePages: boolean;
  readonly form: DocumentForm;
  /** Facts contributed by a custom loader, keyed by fact name. */
  readonly extra?: Readonly<Record<string, boolean>>;
}

/**
 * Below this many characters across the whole document, we call it scanned.
 * A page of real text clears this by an order of magnitude; a page of OCR noise
 * from an image-only PDF does not.
 */
export const MIN_TEXT_LAYER_CHARS = 50;

/** True when `fact` holds for `features`. The one place facts are interpreted. */
export function hasFact(features: DocumentFeatures, fact: DocumentFact): boolean {
  switch (fact) {
    case "TEXT_LAYER":
      return features.hasTextLayer;
    case "GEOMETRY":
      return features.hasGeometry;
    case "RENDERABLE_PAGES":
      return features.hasRenderablePages;
    default:
      return features.extra?.[fact] ?? false;
  }
}
