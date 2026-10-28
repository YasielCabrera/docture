import type { LineSourceId } from "./conversion.js";
import type { LayoutBox } from "./geometry.js";

export type ElementSourceId = `p${number}-element-${string}`;
export type CellSourceId = `p${number}-cell-${string}`;
export type EvidenceSourceId = LineSourceId | ElementSourceId | CellSourceId;

export type EvidenceLocation =
  | { readonly kind: "physical"; readonly pageNumber: number; readonly box: LayoutBox; readonly sourceDigest: string }
  | { readonly kind: "logical"; readonly pageNumber: number }
  | { readonly kind: "unlocated"; readonly pageNumbers: readonly number[] };

interface EvidenceBase {
  /** Display page; physical placement is described only by location. @integer @minimum 1 */
  readonly pageNumber: number;
  readonly elementId: string;
  readonly text: string;
  /** Stable source reading order. @integer @minimum 0 */
  readonly order: number;
  readonly location: EvidenceLocation;
}

/** Native text evidence without a claim that a block or cell is a printed line. */
export interface ElementSourceEvidence extends EvidenceBase {
    readonly granularity: "element";
    /** @pattern ^p[1-9]\d*-element-[a-f0-9]{12}$ */
    readonly id: ElementSourceId;
}

export interface CellSourceEvidence extends EvidenceBase {
    readonly granularity: "table-cell";
    /** @pattern ^p[1-9]\d*-cell-[a-f0-9]{12}$ */
    readonly id: CellSourceId;
    /** @integer @minimum 0 */
    readonly row: number;
    /** @integer @minimum 0 */
    readonly column: number;
    /** @integer @minimum 1 */
    readonly rowSpan: number;
    /** @integer @minimum 1 */
    readonly colSpan: number;
}

export type SourceEvidence = ElementSourceEvidence | CellSourceEvidence;

/** Accept canonical line IDs and neutral content-position IDs for native evidence. */
export function isEvidenceSourceId(id: string): id is EvidenceSourceId {
  return /^p[1-9]\d*-(?:line-[1-9]\d*|(?:element|cell)-[a-f0-9]{12})$/u.test(id);
}
