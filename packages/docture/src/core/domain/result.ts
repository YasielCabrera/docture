/**
 * What comes back. The generic `T` is inferred from the schema the caller passed,
 * so `result.data` is typed all the way to its leaves.
 */

import type { LineSourceId, SourceLine } from "./conversion.js";
import type { DocumentFeatures } from "./document.js";

/** Token and money accounting, summed across every strategy that ran. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Provider prompt-cache reads, included in inputTokens. */
  readonly cacheReadTokens?: number;
  /** Provider prompt-cache writes, included in inputTokens. */
  readonly cacheWriteTokens?: number;
  /** Absent when no model ran or no matching price was configured. */
  readonly costUsd?: number;
  readonly wallMs: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  wallMs: 0,
};

/** Sum counts and reported costs. The caller supplies elapsed wall time. */
export function sumUsage(parts: readonly (Partial<Usage> | undefined)[], wallMs: number): Usage {
  const sum = (field: keyof Usage): number | undefined => {
    const values = parts.map((part) => part?.[field]).filter((value): value is number => value !== undefined);
    return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0);
  };
  const costUsd = sum("costUsd");
  const cacheReadTokens = sum("cacheReadTokens");
  const cacheWriteTokens = sum("cacheWriteTokens");
  return {
    inputTokens: sum("inputTokens") ?? 0,
    outputTokens: sum("outputTokens") ?? 0,
    totalTokens: sum("totalTokens") ?? 0,
    wallMs,
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}

export type AttemptStatus = "ok" | "failed" | "skipped";

/**
 * One strategy run. Every strategy the pipeline touched gets an entry, in order,
 * whether it won, threw, or was skipped — so a fallback is never silent.
 */
export interface Attempt {
  readonly stage: "load" | "classify" | "extract" | "repair" | "layout";
  readonly strategy: string;
  readonly status: AttemptStatus;
  readonly ms: number;
  /** Present when `status` is not "ok". */
  readonly error?: string;
  /** The error's `code` when it was one of ours. */
  readonly errorCode?: string;
  readonly usage?: Partial<Usage>;
  /** Model response text, truncated to the first 10,000 JavaScript characters. */
  readonly rawOutput?: string;
  readonly finishReason?: string;
  readonly issues?: readonly ValidationIssue[];
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

/**
 * A check the schema cannot express, such as "total equals the sum of the lines".
 * It runs on schema-valid data. A thrown error rejects the extraction.
 */
export type ValidationRule<T = unknown> = (
  data: T,
) => readonly ValidationIssue[] | Promise<readonly ValidationIssue[]>;

/**
 * One value a field took, and the pages that gave it. The value is a scalar, or an
 * object or array that met a scalar at the same path.
 */
export interface ConflictingValue {
  readonly value: string | number | boolean | readonly unknown[] | { readonly [key: string]: unknown };
  readonly pages: readonly number[];
}

/**
 * A field whose present values disagreed across the requests of one extraction:
 * different scalars, or a scalar where another request gave an object or array.
 * The data keeps the merge winner; this records every value.
 */
export interface ExtractionConflict {
  /** Dotted path, as in {@link ValidationIssue}. */
  readonly path: string;
  /** Each distinct value in document order. */
  readonly values: readonly ConflictingValue[];
}

/**
 * Where one present leaf of `data` came from. A present leaf is a value that is not
 * an object or an array and is not `null`, `undefined` or a blank string; `0` and
 * `false` are present.
 *
 * - `verified`: the value was found in the cited lines, and `ids` are exactly the
 *   lines the match spans.
 * - `cited-unverified`: the model cited lines, but no normalizer found the value in
 *   them, or the caller's schema changed the value. `ids` are every cited line that
 *   exists, and empty when none did.
 * - `uncited`: the model cited nothing for the value.
 *
 * `path` is dotted, as in {@link ValidationIssue}; a key that contains `.` reads
 * ambiguously.
 */
export type FieldCitation =
  | { readonly path: string; readonly status: "verified"; readonly ids: readonly [LineSourceId, ...LineSourceId[]] }
  | { readonly path: string; readonly status: "cited-unverified"; readonly ids: readonly LineSourceId[] }
  | { readonly path: string; readonly status: "uncited"; readonly ids: readonly [] };

export type CitationStatus = FieldCitation["status"];

/** `"report"` returns the data with its rule issues; `"fail"` fails the attempt. */
export type RuleFailureMode = "report" | "fail";

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
  /** Usage of this classifier, including paid abstentions. */
  readonly usage?: Partial<Usage>;
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
  /**
   * Present only when a multi-request strategy's parts disagreed on a field. A
   * repaired answer keeps the conflicts of the extraction it replaced.
   */
  readonly conflicts?: readonly ExtractionConflict[];
  /**
   * One entry per present leaf of `data`, in depth-first key and index order. Present
   * only when the winning strategy cites, such as `llm({ model, citations: true })`.
   */
  readonly citations?: readonly FieldCitation[];
  /**
   * The loader lines that `citations` name, by page and then line, without
   * duplicates. Present exactly when `citations` is.
   */
  readonly citationSources?: readonly SourceLine[];
}
