/**
 * What comes back. The generic `T` is inferred from the schema the caller passed,
 * so `result.data` is typed all the way to its leaves.
 */

import type { DocumentFeatures } from "./document.js";

/** Token and money accounting, summed across every strategy that ran. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Undefined when no model ran, or when the provider reports no cost. */
  readonly costUsd?: number;
  readonly wallMs: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  wallMs: 0,
};

export type AttemptStatus = "ok" | "failed" | "skipped";

/**
 * One strategy run. Every strategy the pipeline touched gets an entry, in order,
 * whether it won, threw, or was skipped — so a fallback is never silent.
 */
export interface Attempt {
  readonly strategy: string;
  readonly status: AttemptStatus;
  readonly ms: number;
  /** Present when `status` is not "ok". */
  readonly error?: string;
  /** The error's `code` when it was one of ours. */
  readonly errorCode?: string;
  readonly usage?: Partial<Usage>;
}

export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. `lineItems.3.amount`. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationOutcome {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface ClassificationResult<Name extends string = string> {
  readonly name: Name | "UNKNOWN";
  /** 0–1. */
  readonly confidence: number;
  /** Every classifier's verdict, deduplicated — including the abstentions. */
  readonly signals: readonly ClassificationSignal[];
}

export interface ClassificationSignal {
  readonly classifier: string;
  readonly name: string | null;
  readonly confidence: number;
  readonly note?: string;
}

export interface ExtractionResult<T> {
  /** The extracted data, typed from the schema. */
  readonly data: T;
  /** Which strategy produced `data`. */
  readonly method: string;
  /** Which loader read the document. */
  readonly loader: string;
  /** Every strategy run, in order. The last one is the winner. */
  readonly attempts: readonly Attempt[];
  readonly classification?: ClassificationResult;
  readonly features: DocumentFeatures;
  readonly usage: Usage;
  readonly validation: ValidationOutcome;
}
