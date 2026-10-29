import { compareRuns } from "../comparison/index.js";
import { RunStoreError } from "../errors.js";
import { gate } from "../gate/gate.js";
import type { GateOptions } from "../gate/types.js";
import type { JsonValue } from "../json.js";
import type { MetricDefinition } from "../metrics/types.js";
import { buildResult } from "../result/build.js";
import type { CaseResult, EvalResult, ResultSection, RunInfo } from "../result/types.js";
import type { SliceMap } from "../slices.js";
import { resolveBaseline, type RunStore } from "../store.js";

/** Analyses and checks applied to finished rows. `runEval` and `rescore` both accept them. */
export interface ResultOptions<T> {
  readonly metrics?: readonly MetricDefinition[];
  readonly slices?: SliceMap<T>;
  readonly sections?: readonly ResultSection[];
  /** A run id, `"auto"` for the latest complete run of the same dataset on this branch, or `false`. Needs a store. */
  readonly baseline?: string | false;
  /** Branch searched when `baseline: "auto"` finds no complete run on the run's own branch. Default: none. */
  readonly fallbackBranch?: string;
  /** Checked by `gate`, which also fails a run that is not `complete`. */
  readonly gate?: GateOptions;
  readonly enrich?: (result: EvalResult) => Readonly<Record<string, JsonValue>>;
}

/** Build the result, apply sections, the baseline comparison, the gate and `enrich`, then store it. */
export async function finishResult<T>(
  store: RunStore | undefined,
  run: RunInfo,
  rows: readonly CaseResult[],
  warnings: readonly string[],
  options: ResultOptions<T>,
): Promise<EvalResult> {
  const metrics = options.metrics ? { metrics: options.metrics } : {};
  let result = buildResult({ run, cases: rows, warnings, ...metrics });
  for (const section of options.sections ?? []) result = { ...result, ...section(result) };
  if (options.baseline) {
    if (!store) throw new RunStoreError("Baseline comparison requires a store.", "not-found");
    const id =
      options.baseline === "auto"
        ? await resolveBaseline(store, {
            exclude: run.id,
            requireSameDataset: true,
            datasetFingerprint: run.dataset.fingerprint,
            ...(run.git ? { branch: run.git.branch } : {}),
            ...(options.fallbackBranch === undefined ? {} : { fallbackBranch: options.fallbackBranch }),
          })
        : options.baseline;
    if (id) result = { ...result, comparison: compareRuns(await store.readResult(id), result) };
  }
  if (options.gate) result = { ...result, gate: gate(result, options.gate) };
  if (options.enrich) result = { ...result, extensions: options.enrich(result) };
  await store?.finalize(result);
  return result;
}
