import { EvalSpecError } from "./errors.js";
import type { FieldEvidence } from "./extractor.js";
import type { CaseResult, EvalResult, MetricValues, RunInfo } from "./result/types.js";

/** Addresses one raw processor output. */
export interface RawKey {
  readonly experiment: string;
  readonly caseId: string;
  readonly epoch: number;
}

/**
 * A processor's raw output with the scoring signals `rescore` and resume need, kept per job.
 * Not part of the result contract.
 */
export interface StoredRaw {
  readonly raw: unknown;
  readonly confidence?: Readonly<Record<string, number>>;
  readonly evidence?: readonly FieldEvidence[];
  /** The experiment config hash of the job that wrote it. Resume reuses the output only when it matches. */
  readonly configHash?: string;
  /** The content hash of the case that produced it. Resume reuses the output only when it matches. */
  readonly caseFingerprint?: string;
}

/** One line of a store's run index, enough to list runs and pick a baseline without reading results. */
export interface RunIndexEntry {
  readonly id: string;
  readonly status: RunInfo["status"];
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly git?: RunInfo["git"];
  readonly dataset: { readonly id: string; readonly size: number; readonly fingerprint: string };
  readonly spec: { readonly fingerprint: string };
  readonly experiments: readonly { readonly id: string; readonly configHash: string }[];
  readonly rescoredFrom?: string;
  /** Overall metrics per experiment, present once the run is finalized. */
  readonly summary?: Readonly<Record<string, MetricValues>>;
}

/** A run as stored so far: its metadata and the rows appended before it stopped. */
export interface StoredRun {
  readonly run: RunInfo;
  readonly cases: readonly CaseResult[];
}

/**
 * Where runs live. A file store and an in-memory store both implement it; the
 * runner, resume, `rescore`, baseline resolution and the CLI only call these methods.
 */
export interface RunStore {
  /** Register a run with status `in-progress`. Throws `RunStoreError` (`conflict`) for an existing id. */
  createRun(run: RunInfo): Promise<void>;
  /** Append one finished row. Rows survive a crash, so an aborted run can resume. */
  appendCase(runId: string, row: CaseResult): Promise<void>;
  /** Keep the processor's raw output and scoring signals for re-scoring, replacing an earlier one for the same key. */
  writeRaw(runId: string, key: RawKey, value: StoredRaw): Promise<void>;
  /** The stored raw output, or `undefined` when none was kept. Throws `RunStoreError` (`format`) for a damaged one. */
  readRaw(runId: string, key: RawKey): Promise<StoredRaw | undefined>;
  /** Run metadata and appended rows, for resume. Throws `RunStoreError` (`not-found`). */
  openRun(runId: string): Promise<StoredRun>;
  /** Store the final result and update the index entry's status and summary. */
  finalize(result: EvalResult): Promise<void>;
  /** Index entries, oldest first. */
  listRuns(): Promise<readonly RunIndexEntry[]>;
  /** The finalized result with its cases. Throws `RunStoreError` (`not-found`) when the run was never finalized. */
  readResult(runId: string): Promise<EvalResult>;
}

/** How {@link resolveBaseline} picks a run. */
export interface BaselineQuery {
  /** Look on this branch first. Default: any branch. */
  readonly branch?: string;
  /** Look here when `branch` has no complete run, such as `main`. */
  readonly fallbackBranch?: string;
  /** Only runs over the dataset whose fingerprint is `datasetFingerprint`. */
  readonly requireSameDataset?: boolean;
  readonly datasetFingerprint?: string;
  /** A run id never to pick, such as the run being compared. */
  readonly exclude?: string;
}

/**
 * The id of the most recently started `complete` run on `branch`, then on `fallbackBranch`,
 * or `undefined` when none qualifies. Throws {@link EvalSpecError} when `requireSameDataset`
 * has no `datasetFingerprint` to compare against.
 */
export async function resolveBaseline(store: Pick<RunStore, "listRuns">, query: BaselineQuery = {}): Promise<string | undefined> {
  if (query.requireSameDataset === true && query.datasetFingerprint === undefined) {
    throw new EvalSpecError([{ code: "invalid-rule", path: "baseline.datasetFingerprint", message: "requireSameDataset needs the dataset fingerprint to match" }]);
  }
  const eligible = (await store.listRuns())
    .map((entry, order) => ({ entry, order, started: Date.parse(entry.startedAt) || -Infinity }))
    .filter(({ entry }) => entry.status === "complete" && entry.id !== query.exclude
      && (query.requireSameDataset !== true || entry.dataset.fingerprint === query.datasetFingerprint))
    .sort((a, b) => b.started - a.started || b.order - a.order);
  const branches = [query.branch, query.fallbackBranch].filter((branch) => branch !== undefined);
  if (branches.length === 0) return eligible[0]?.entry.id;
  for (const branch of branches) {
    const found = eligible.find(({ entry }) => entry.git?.branch === branch);
    if (found !== undefined) return found.entry.id;
  }
  return undefined;
}
