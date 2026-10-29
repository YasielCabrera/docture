import type { PrfScope } from "../metrics/builtin.js";
import type { SliceFilter } from "../result/sections.js";

/** A bound on one metric. Restrict it to one of a segment, a slice value or a path pattern, or leave all three out for the whole experiment. */
export interface GateThreshold {
  /** Metric id, such as `f1`, `errorRate` or a custom metric. */
  readonly metric: string;
  /** For precision, recall and F1. Default `run`, which counts errored cases' fields as omissions. */
  readonly scope?: PrfScope;
  /** Default: every experiment in the result. */
  readonly experiment?: string;
  readonly segment?: string;
  /** Exactly one slice name and value, such as `{ rendition: "scan-lq" }`. */
  readonly slice?: SliceFilter;
  /** Path pattern, such as `totals.total`. Precision, recall and F1 at run scope only. */
  readonly path?: string;
  readonly min?: number;
  readonly max?: number;
}

/** Pass and fail rules for a result. */
export interface GateOptions {
  readonly thresholds?: readonly GateThreshold[];
  /** Budgets against every experiment in the result's run comparison. */
  readonly regressions?: {
    /** Largest allowed drop of each metric's summary value, keyed by metric id. */
    readonly maxDrop?: Readonly<Record<string, number>>;
    /** Fail only on drops whose verdict is `regressed`. Without `maxDrop`, fail on every `regressed` verdict. */
    readonly requireSignificance?: boolean;
  };
  readonly maxErrorRate?: number;
  readonly maxFallbackRate?: number;
  /** What a missing value means. Default `fail`. */
  readonly onNull?: "fail" | "pass";
}

/** One evaluated gate rule. A `run` check fails a run that is not `complete`; it is absent for a complete run. */
export interface GateCheck {
  readonly kind: "run" | "threshold" | "regression";
  readonly experiment: string;
  readonly metric: string;
  /** What was measured, such as `f1`, `f1 in segment totals` or `f1 for rendition=scan-lq`. */
  readonly target: string;
  readonly value: number | null;
  readonly min?: number;
  readonly max?: number;
  /** `skipped` means there was nothing to check and `onNull` is `pass`, or no comparison exists. */
  readonly status: "pass" | "fail" | "skipped";
  readonly message: string;
}

/** The gate's verdict. It passes when no check failed. */
export interface GateResult {
  readonly pass: boolean;
  readonly checks: readonly GateCheck[];
}
