/** Optional refinement of the deterministic layout analysis. */

import type {
  ConversionWarning,
  DocumentElement,
  LayoutDocument,
} from "../domain/conversion.js";
import type { Logger } from "../domain/logger.js";
import type { Usage } from "../domain/result.js";

/** Roles an analyzer may assign. Page furniture is decided by core and never reaches an analyzer. */
export type LayoutElementRole = Exclude<DocumentElement["kind"], "page-header" | "page-footer">;

/**
 * Analyzer output deliberately contains no text. It can classify and order known
 * elements, but it cannot add, remove or rewrite the document's content.
 */
export interface LayoutAnnotation {
  readonly id: string;
  readonly role?: LayoutElementRole;
  readonly level?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Elements with the same page-local label are grouped after ordering. */
  readonly group?: string;
  /** Zero-based order inside the element's page. */
  readonly order?: number;
}

export interface LayoutAnalyzerContext {
  /** The deterministic layout without page headers and footers. */
  readonly document: LayoutDocument;
  readonly signal: AbortSignal;
  readonly logger: Logger;
}

export interface LayoutAnalysis {
  readonly annotations: readonly LayoutAnnotation[];
  readonly warnings?: readonly ConversionWarning[];
  readonly usage?: Partial<Usage>;
}

export interface LayoutAnalyzer {
  readonly name: string;
  analyze(ctx: LayoutAnalyzerContext): Promise<LayoutAnalysis>;
  dispose?(): Promise<void>;
}

export function defineLayoutAnalyzer(analyzer: LayoutAnalyzer): LayoutAnalyzer {
  return analyzer;
}
