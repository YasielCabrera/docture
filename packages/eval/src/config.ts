import type { Dataset } from "./case.js";
import type { EvalExtractor } from "./extractor.js";
import type { GateOptions } from "./gate/types.js";
import type { JsonValue } from "./json.js";
import type { MetricDefinition } from "./metrics/types.js";
import type { Reporter } from "./reporter.js";
import type { EvalResult, ResultSection } from "./result/types.js";
import type { SliceMap } from "./slices.js";
import type { EvalSpec } from "./spec/types.js";
import type { RunStore } from "./store.js";

/** The configuration `docture eval` loads from `docture.eval.ts`. */
export interface EvalConfig<T = unknown> {
  readonly dataset: Dataset<T>;
  readonly spec: EvalSpec<T>;
  /** One processor, or several keyed by experiment id. */
  readonly experiments: Readonly<Record<string, EvalExtractor<unknown, T>>> | EvalExtractor<unknown, T>;
  readonly slices?: SliceMap<T>;
  readonly metrics?: readonly MetricDefinition[];
  /** Analyses applied before the gate and reporters, such as `calibrationSection()` or `groundingSection()`. */
  readonly sections?: readonly ResultSection[];
  readonly reporters?: readonly Reporter[];
  readonly gate?: GateOptions;
  /** A store directory, or a store object. */
  readonly store?: string | RunStore;
  /** A run id, `auto` for the latest complete run of the same dataset on the current branch, or `false`. */
  readonly baseline?: string | false;
  /** Branch `auto` searches when the current branch has no complete run, such as `main`. Default: none. */
  readonly fallbackBranch?: string;
  readonly concurrency?: number;
  readonly epochs?: number;
  /** Project data added to `result.extensions`. */
  readonly enrich?: (result: EvalResult) => Readonly<Record<string, JsonValue>>;
}

/** Type a `docture.eval.ts` config. Identity at runtime. */
export function defineEvalConfig<T>(config: EvalConfig<T>): EvalConfig<T> {
  return config;
}
