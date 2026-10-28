import type { ElementProvenance, ProvenanceSegment } from "../domain/conversion.js";
import { unionBox } from "./candidates.js";

/**
 * Every page's share of an element's source: the page where it starts, then each
 * later page it continues onto, in page order.
 *
 * @example
 * ```ts
 * import { DocumentConverter, provenanceSegments } from "docture";
 * import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
 *
 * const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderPdfJs());
 * const result = await converter.convert("report.pdf", { format: "json" });
 * for (const element of result.pages.flatMap((page) => page.elements)) {
 *   const pages = provenanceSegments(element.provenance).map((segment) => segment.pageNumber);
 *   console.log(element.id, pages); // "p1-010d3a61615a" [1, 2] for a table that continues onto page 2
 * }
 * ```
 */
export function provenanceSegments(provenance: ElementProvenance): readonly ProvenanceSegment[] {
  const { continuations, ...primary } = provenance;
  return [primary, ...(continuations ?? [])];
}

/** `provenance` extended onto the primary segment of `next`, a later page. */
export function withContinuation(provenance: ElementProvenance, next: ElementProvenance): ElementProvenance {
  const [segment] = provenanceSegments(next);
  return segment === undefined ? provenance : { ...provenance, continuations: [...(provenance.continuations ?? []), segment] };
}

/** One segment per page in ascending page order: the union box and the ids in first-seen order. */
export function mergeSegments(segments: readonly ProvenanceSegment[]): readonly ProvenanceSegment[] {
  const pages = [...new Set(segments.map((segment) => segment.pageNumber))].sort((a, b) => a - b);
  return pages.map((pageNumber) => {
    const parts = segments.filter((segment) => segment.pageNumber === pageNumber);
    const lineIds = [...new Set(parts.flatMap((segment) => segment.lineIds ?? []))];
    return {
      pageNumber,
      box: unionBox(parts.map((segment) => segment.box)),
      sourceIds: [...new Set(parts.flatMap((segment) => segment.sourceIds))],
      ...(lineIds.length === 0 ? {} : { lineIds }),
    };
  });
}
