import type { AlignmentReport } from "../align/align.js";
import type { Box, ExpectedLocation } from "../case.js";
import type { RepairHint } from "../compare/types.js";
import type { JsonValue } from "../json.js";
import type { AssertionResult } from "./assertions.js";

/** How one leaf fared. Omission: expected but absent. Hallucination: present but not expected. */
export type FieldStatus = "match" | "mismatch" | "omission" | "hallucination";

export interface StatusCounts {
  readonly match: number;
  readonly mismatch: number;
  readonly omission: number;
  readonly hallucination: number;
}

/** Precision, recall and F1. `null` means there was nothing to grade, never a perfect score. */
export interface Prf {
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
}

/** Where the processor said it found a value. */
export interface EvidenceRef {
  readonly pageNumber: number;
  readonly box?: Box;
  readonly status?: string;
}

/** The comparison of one leaf. */
export interface FieldResult {
  /** Concrete path on the expected side. Unpaired actual rows continue the expected numbering. */
  readonly path: string;
  /** Concrete path on the actual side, present only when it differs from `path`. */
  readonly actualPath?: string;
  readonly pattern: string;
  readonly segment: string;
  readonly status: FieldStatus;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
  /** Comparator id. */
  readonly comparator: string;
  readonly similarity: number;
  readonly weight: number;
  /** Present and true only for critical fields. */
  readonly critical?: true;
  readonly hint?: RepairHint;
  readonly note?: string;
  readonly confidence?: number;
  readonly evidence?: readonly EvidenceRef[];
  readonly locations?: readonly ExpectedLocation[];
  /**
   * {@link isGrounded} under the default rule: correct and supported by evidence at an expected location.
   * `null` when the field has no expected location. Absent when the case supplied neither locations nor evidence.
   */
  readonly grounded?: boolean | null;
}

export interface SegmentScore extends Prf {
  readonly counts: StatusCounts;
  readonly weighted: StatusCounts;
}

/** Everything `spec.score` knows about one case. Precision, recall and F1 use weighted counts. */
export interface CaseScore {
  readonly fields: readonly FieldResult[];
  readonly arrays: readonly AlignmentReport[];
  readonly assertions: readonly AssertionResult[];
  readonly counts: StatusCounts;
  readonly weighted: StatusCounts;
  readonly metrics: Prf & {
    /** No mismatch, omission or hallucination. */
    readonly exact: boolean;
    /** Mean ANLS over expected leaves, or `null` when nothing was expected. */
    readonly anls: number | null;
    /** Every critical field matched. True when there are none. */
    readonly critical: boolean;
  };
  readonly segments: Readonly<Record<string, SegmentScore>>;
}

export const ZERO_COUNTS: StatusCounts = { match: 0, mismatch: 0, omission: 0, hallucination: 0 };

export function addCounts(a: StatusCounts, b: StatusCounts): StatusCounts {
  return {
    match: a.match + b.match,
    mismatch: a.mismatch + b.mismatch,
    omission: a.omission + b.omission,
    hallucination: a.hallucination + b.hallucination,
  };
}

/** Precision, recall and F1 from counts. F1 is 2·match / (2·match + 2·mismatch + omission + hallucination), so it is 0 when expected fields exist but nothing was predicted, and null when there are neither expected nor predicted fields. */
export function prf(counts: StatusCounts): Prf {
  const predicted = counts.match + counts.mismatch + counts.hallucination;
  const relevant = counts.match + counts.mismatch + counts.omission;
  const f1Denominator = predicted + relevant;
  return {
    precision: predicted === 0 ? null : counts.match / predicted,
    recall: relevant === 0 ? null : counts.match / relevant,
    f1: f1Denominator === 0 ? null : (2 * counts.match) / f1Denominator,
  };
}
