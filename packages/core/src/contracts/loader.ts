/**
 * The loader contract.
 *
 * A loader is a plain object. There is no abstract base class to extend — which is
 * the point: `implements DocumentLoader` is structural, so a fake in a test is an
 * object literal, and a real loader is whatever wraps your library of choice.
 *
 * Naming convention across this repo: one package per library, one class named
 * after that library (`PdfJsLoader`, `MuPdfLoader`, `TesseractJsLoader`). The
 * library you are depending on should be obvious from the call site.
 */

import type { DocumentFact, RawDocument } from "../domain/document.js";
import type { LoadedDocument } from "../domain/geometry.js";
import type { Logger } from "../domain/logger.js";

/**
 * What a loader can produce. The three booleans are TYPE parameters, not just
 * values, so a strategy can demand a capability and the compiler enforces it at
 * the wiring site — see {@link GeometryLoader}.
 */
export interface LoaderCapabilities<
  Text extends boolean = boolean,
  Geometry extends boolean = boolean,
  Images extends boolean = boolean,
> {
  /** Produces page text. */
  readonly text: Text;
  /** Produces positioned word/line boxes, not merely a text blob. */
  readonly geometry: Geometry;
  /** Can render pages to images. */
  readonly images: Images;
  /** Media types this loader will accept. */
  readonly mimeTypes: readonly string[];
  /** Extra facts this loader publishes for custom strategies to require. */
  readonly facts?: readonly DocumentFact[];
}

export interface LoadContext {
  readonly signal: AbortSignal;
  readonly logger: Logger;
  /** Optional conversion-only data. A loader may ignore fields it cannot provide. */
  readonly request?: LoadRequest;
}

export interface LoadRequest {
  readonly layout?: boolean;
  readonly assets?: boolean;
}

export interface DocumentLoader<C extends LoaderCapabilities = LoaderCapabilities> {
  /** Stable id. Appears in `result.loader`. */
  readonly name: string;
  readonly capabilities: C;
  load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument>;
  /** Release engines, workers, WASM instances. Called once, by whoever composed. */
  dispose?(): Promise<void>;
}

/**
 * A loader that is guaranteed AT COMPILE TIME to produce positioned geometry.
 *
 * ```ts
 * new TableStrategy({ loader: new PdfJsLoader() });     // ok — geometry: true
 * new TableStrategy({ loader: new PdfParseLoader() });   // Type error — geometry: false
 * ```
 */
export type GeometryLoader = DocumentLoader<LoaderCapabilities<boolean, true, boolean>>;

/** A loader guaranteed to produce text. */
export type TextLoader = DocumentLoader<LoaderCapabilities<true, boolean, boolean>>;

/** A loader guaranteed to be able to render pages. */
export type ImageLoader = DocumentLoader<LoaderCapabilities<boolean, boolean, true>>;

/**
 * Identity helper that pins the capability literals.
 *
 * Without it, `{ text: true }` widens to `boolean` and the compile-time capability
 * check above silently stops working. The `const` type parameter is what keeps
 * `true` as `true`.
 */
export function defineLoader<const C extends LoaderCapabilities>(
  loader: DocumentLoader<C>,
): DocumentLoader<C> {
  return loader;
}

/** True when this loader accepts `mimeType`. `*​/*` accepts anything. */
export function loaderAccepts(loader: DocumentLoader, mimeType: string): boolean {
  const accepted = loader.capabilities.mimeTypes;
  return accepted.some(
    (m) =>
      m === "*/*" ||
      m === mimeType ||
      (m.endsWith("/*") && mimeType.startsWith(m.slice(0, -1))),
  );
}
