import type { Box, EvalCase } from "./case.js";
import type { JsonValue } from "./json.js";

/** Usage a processor reports for one case. Every field is optional because processors measure different things. */
export interface UsageInfo {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly calls?: number;
  readonly pages?: number;
  /** Absent when no price was known. */
  readonly costUsd?: number;
  readonly wallMs?: number;
}

/** Where a processor found a value. Neutral, so a non-Docture processor can supply it. */
export interface FieldEvidence {
  /** Concrete path in the processor's output, such as `lineItems[0].amount`. */
  readonly path: string;
  readonly pageNumber: number;
  readonly box?: Box;
  /** Processor-specific evidence status, such as Docture's `verified` or `cited-unverified`. */
  readonly status?: string;
  readonly confidence?: number;
}

/** What the runner passes to a processor with each case. */
export interface ExtractContext {
  readonly signal: AbortSignal;
  readonly epoch: number;
  readonly experiment: string;
}

/** A processor's answer for one case. */
export interface ExtractOutput<Raw> {
  readonly raw: Raw;
  readonly usage?: UsageInfo;
  readonly method?: string;
  readonly fallback?: boolean;
  /** Confidence in 0 to 1 keyed by concrete output path. */
  readonly confidence?: Readonly<Record<string, number>>;
  readonly evidence?: readonly FieldEvidence[];
  readonly diagnostics?: JsonValue;
}

/** Turns a case's documents into output. Typed by the methods the runner calls, so any copy or implementation fits. */
export interface EvalExtractor<Raw = unknown, T = unknown> {
  readonly id: string;
  /** Hashed into the experiment's config hash, which keys resume and comparison. */
  readonly config?: JsonValue;
  preflight?(ctx: { readonly signal: AbortSignal }): Promise<void>;
  /**
   * Throw `OutOfScopeError` to skip the case. Any other throw records an errored case; when the thrown value
   * has a `usage` member shaped like {@link UsageInfo}, as Docture's extraction errors do, the case keeps that
   * usage, so a failed paid call still counts toward cost and tokens.
   */
  extract(input: EvalCase<unknown>, ctx: ExtractContext): Promise<ExtractOutput<Raw>>;
  /** Raw output to the comparable view. Runs again on rescore. */
  project?(raw: Raw): T;
  /** Always called once the run ends, whether it succeeded, failed or was aborted. */
  dispose?(): void | Promise<void>;
}
