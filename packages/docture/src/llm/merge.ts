/**
 * Merging partial extractions.
 *
 * `concatenate` and `paginate` both send the document in pieces and get a partial
 * answer per piece. Reassembling them needs one rule set, applied everywhere:
 *
 *   - **arrays concatenate.** A table split across pages is one table; page 2's rows
 *     come after page 1's.
 *   - **scalars: first present wins**, except a later same-type non-zero value
 *     replaces an earlier `0` or `false`. Mismatched types keep first-present.
 *   - **objects recurse**, so a nested address block merges field by field.
 *
 * A genuine early zero can be replaced by this rule. Nulls and blank strings
 * still cannot overwrite present values.
 */

import type { ExtractionConflict } from "../core/index.js";
import { foldParts, type MergePart } from "./fold.js";

export type { MergePart } from "./fold.js";

export interface MergeDiagnostics {
  readonly data: unknown;
  /** Paths where present values differ, in order of first appearance. */
  readonly conflicts: readonly ExtractionConflict[];
}

/**
 * Fold partial extractions, in document order, and report each path whose present
 * scalars disagree, or where a scalar met an object or array, with the pages behind
 * each value. The merged data follows the same rules as {@link mergePartials}; a zero
 * or `false` that a later value replaced still counts as one of the disagreeing values.
 */
export function mergePartialsWithDiagnostics(parts: readonly MergePart[]): MergeDiagnostics {
  const { data, conflicts } = foldParts(parts);
  return { data, conflicts };
}

/** Fold partial extractions, in document order, into one. */
export function mergePartials(parts: readonly unknown[]): unknown {
  return mergePartialsWithDiagnostics(parts.map((data) => ({ data, pages: [] }))).data;
}
