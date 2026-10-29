import type { Dataset, EvalCase } from "../case.js";
import { DatasetError, RunStoreError } from "../errors.js";
import type { EvalExtractor } from "../extractor.js";
import type { CaseResult, EvalResult, RunInfo } from "../result/types.js";
import type { EvalSpec } from "../spec/types.js";
import type { RunStore } from "../store.js";
import { datasetFingerprint } from "../dataset/index.js";
import { finishResult, type ResultOptions } from "./finish.js";
import { erroredRow, rowMetadata, scoredRow, signalsOf, validateTruth, withValues, type RowBase } from "./rows.js";

/** Replacement truth, projections and analyses for {@link rescore}. */
export interface RescoreOptions<T> extends ResultOptions<T> {
  /** Re-read ground truth, tags, groups and locations from these cases. Required when `slices` is given. */
  readonly dataset?: Dataset<T>;
  /** The `project` of each experiment, keyed by experiment id. Without one, the stored raw output is scored as is. */
  readonly extractors?: Readonly<Record<string, Pick<EvalExtractor<unknown, T>, "project">>>;
  /** Where the source run and its raw outputs are read, such as a copied run directory. Default: `store`. */
  readonly source?: Pick<RunStore, "readResult" | "readRaw">;
}

function metadataOf(row: CaseResult): Omit<RowBase, "usage" | "method" | "fallback" | "diagnostics"> {
  return {
    caseId: row.caseId,
    experiment: row.experiment,
    epoch: row.epoch,
    tags: row.tags,
    startedAt: row.startedAt,
    ms: row.ms,
    ...(row.caseFingerprint === undefined ? {} : { caseFingerprint: row.caseFingerprint }),
    ...(row.configHash === undefined ? {} : { configHash: row.configHash }),
    ...(row.group === undefined ? {} : { group: row.group }),
    ...(row.locations === undefined ? {} : { locations: row.locations }),
    ...(row.slices === undefined ? {} : { slices: row.slices }),
  };
}

/**
 * Score a stored run again from its raw outputs, without calling `extract`, and store the outcome in `store`
 * as a new run whose `run.rescoredFrom` names the source run. The source run is never changed. Warnings,
 * comparison and gate describe the new run, so they come from `options`, not from the source.
 */
export async function rescore<T>(store: RunStore, runId: string, spec: EvalSpec<T>, options: RescoreOptions<T> = {}): Promise<EvalResult> {
  if (options.slices && !options.dataset) throw new DatasetError("Rescoring with slices needs the dataset whose cases the slices read.");
  const from = options.source ?? store;
  const source = await from.readResult(runId);
  const items = options.dataset ? new Map((await options.dataset.cases()).map((item) => [item.id, item])) : undefined;
  const caseIds = [...new Set(source.cases.map((row) => row.caseId))];
  const missing = items ? caseIds.filter((id) => !items.has(id)) : [];
  if (missing.length) throw new DatasetError(`Replacement dataset has no case ${missing.join(", ")}.`);
  const current = (id: string): EvalCase<T> | undefined => items?.get(id);
  const truth = validateTruth(
    source.cases.flatMap((row) => {
      if (row.outcome === "skipped") return [];
      const item = current(row.caseId);
      return [{ id: row.caseId, expected: item ? item.expected : row.expected }];
    }),
    spec,
  );
  const truthOf = (id: string): T => {
    if (!truth.has(id)) throw new DatasetError(`Case ${id} has no validated ground truth.`, id);
    return truth.get(id) as T;
  };

  const used = items ? caseIds.flatMap((id) => items.get(id) ?? []) : [];
  const { finishedAt: _finishedAt, ...sourceRun } = source.run;
  const run: RunInfo = {
    ...sourceRun,
    id: globalThis.crypto.randomUUID(),
    status: "in-progress",
    startedAt: new Date().toISOString(),
    spec: spec.info,
    rescoredFrom: runId,
    ...(items ? { dataset: { ...source.run.dataset, fingerprint: datasetFingerprint(used) } } : {}),
  };
  await store.createRun(run);
  const rows: CaseResult[] = [];
  for (const row of source.cases) {
    const item = current(row.caseId);
    const refreshed = item
      ? {
          ...(row.slices === undefined ? {} : { slices: row.slices }),
          ...rowMetadata(item, row, options.slices),
          startedAt: row.startedAt,
          ms: row.ms,
        }
      : metadataOf(row);
    const base: RowBase = { ...refreshed, ...signalsOf(row) };
    let next: CaseResult;
    if (row.outcome === "skipped") next = { ...base, outcome: "skipped", reason: row.reason };
    else {
      const expected = truthOf(row.caseId);
      if (row.outcome === "errored") next = await erroredRow(spec, expected, row.error, base);
      else {
        const key = { caseId: row.caseId, experiment: row.experiment, epoch: row.epoch };
        const stored = await from.readRaw(runId, key);
        if (!stored) throw new RunStoreError(`Raw output missing for ${row.caseId}/${row.experiment}/${row.epoch}.`, "not-found");
        await store.writeRaw(run.id, key, stored);
        const project = options.extractors?.[row.experiment]?.project;
        next = await scoredRow(spec, expected, item ? item.locations : row.locations, stored, project, base);
      }
    }
    const valued = withValues(run, next, options.metrics);
    await store.appendCase(run.id, valued);
    rows.push(valued);
  }
  return finishResult(store, { ...run, status: source.run.status, finishedAt: new Date().toISOString() }, rows, [], options);
}
