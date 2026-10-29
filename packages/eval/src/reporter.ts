import type { CaseResult, EvalResult, RunInfo } from "./result/types.js";

/** Live run progress passed with each finished case. */
export interface Progress {
  readonly completed: number;
  readonly total: number;
  readonly scored: number;
  readonly errored: number;
  readonly skipped: number;
  readonly elapsedMs: number;
}

/** Renders or ships a result. Only `onResult` is required; the live hooks serve progress displays. */
export interface Reporter {
  readonly id: string;
  onRunStart?(run: RunInfo): void | Promise<void>;
  onCase?(row: CaseResult, progress: Progress): void | Promise<void>;
  onResult(result: EvalResult): void | Promise<void>;
}

/** Declare a custom reporter. Identity at runtime; it pins the type. */
export function defineReporter(reporter: Reporter): Reporter {
  return reporter;
}
