import { PricedExtractionFailure } from "../errors.js";
import type { Dataset, EvalCase } from "../case.js";
import type { EvalExtractor } from "../extractor.js";
import type { EvalSpec } from "../spec/types.js";
import type { RunStore, StoredRaw, StoredRun } from "../store.js";
import type { Reporter } from "../reporter.js";
import type { CaseResult, EvalResult, RunInfo } from "../result/types.js";
import { DatasetError, OutOfScopeError, PreflightError, RunStoreError } from "../errors.js";
import { buildResult } from "../result/build.js";
import { fingerprintOf } from "../hash.js";
import { datasetFingerprint, sample, caseFingerprint, type SampleOptions } from "../dataset/index.js";
import { finishResult, type ResultOptions } from "./finish.js";
import { parseFailureUsage, parseProcessorOutput } from "./output.js";
import { erroredRow, rowMetadata, scoredRow, signalsOf, validateTruth, withValues, type JobKey, type RowBase } from "./rows.js";
export { memoryRunStore } from "./store.js";
export { rescore, type RescoreOptions } from "./rescore.js";
export type { ResultOptions } from "./finish.js";
export type { ResultSection } from "../result/types.js";
export type { EvalExtractor, ExtractContext, ExtractOutput } from "../extractor.js";

/** Inputs to the portable evaluation runner. */
export interface RunEvalOptions<T> extends ResultOptions<T> {
  readonly dataset: Dataset<T>;
  readonly spec: EvalSpec<T>;
  readonly experiments: Readonly<Record<string, EvalExtractor<unknown, T>>> | EvalExtractor<unknown, T>;
  readonly select?: { readonly ids?: readonly string[]; readonly sample?: SampleOptions<T> };
  readonly concurrency?: number;
  readonly epochs?: number;
  readonly signal?: AbortSignal;
  readonly git?: NonNullable<RunInfo["git"]>;
  readonly store?: RunStore;
  /**
   * Continue an unfinished run: its id, or `"latest"` for the most recently started `in-progress` or `aborted`
   * run of the same dataset id and experiment ids. A `complete` run is never resumed. Rows are reused when case
   * content, experiment config and epoch match; reused rows are re-scored from stored raw output with the
   * current spec, and errored rows are retried.
   */
  readonly resume?: string | false;
  readonly reporters?: readonly Reporter[];
}

type Experiment<T> = readonly [id: string, processor: EvalExtractor<unknown, T>];
interface Job<T> {
  readonly item: EvalCase<T>;
  readonly processor: EvalExtractor<unknown, T>;
  readonly key: JobKey & { readonly configHash: string };
}

function experimentEntries<T>(value: RunEvalOptions<T>["experiments"]): Experiment<T>[] {
  if ("extract" in value && typeof value.extract === "function" && typeof value.id === "string")
    return [[value.id, value as EvalExtractor<unknown, T>]];
  return Object.entries(value as Readonly<Record<string, EvalExtractor<unknown, T>>>);
}
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new DatasetError(`${name} must be a positive integer.`);
  return value;
}
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

async function selectCases<T>(options: RunEvalOptions<T>): Promise<readonly EvalCase<T>[]> {
  let items = await options.dataset.cases();
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new DatasetError("Dataset contains duplicate case ids.");
  const selected = options.select?.ids;
  if (selected) {
    const unknown = selected.filter((id) => !ids.has(id));
    if (unknown.length) throw new DatasetError(`Unknown case ids: ${unknown.join(", ")}`);
    items = items.filter((item) => selected.includes(item.id));
  }
  return options.select?.sample ? sample(items, options.select.sample) : items;
}

async function openResumed(
  store: RunStore | undefined,
  resume: string,
  datasetId: string,
  experimentIds: readonly string[],
): Promise<StoredRun> {
  if (!store) throw new RunStoreError("Resume requires a run store.", "not-found");
  let id = resume;
  if (resume === "latest") {
    const candidates = (await store.listRuns())
      .map((entry, order) => ({ entry, order, started: Date.parse(entry.startedAt) || -Infinity }))
      .filter(
        ({ entry }) =>
          entry.status !== "complete" &&
          entry.dataset.id === datasetId &&
          sameIds(
            entry.experiments.map((e) => e.id),
            experimentIds,
          ),
      )
      .sort((a, b) => b.started - a.started || b.order - a.order);
    const latest = candidates[0]?.entry.id;
    if (latest === undefined)
      throw new RunStoreError(
        `No unfinished run of dataset ${datasetId} with experiments ${experimentIds.join(", ")} to resume.`,
        "not-found",
      );
    id = latest;
  }
  const stored = await store.openRun(id);
  if (stored.run.status === "complete") throw new RunStoreError(`Run ${id} is complete and cannot be resumed.`, "conflict");
  if (
    stored.run.dataset.id !== datasetId ||
    !sameIds(
      stored.run.experiments.map((e) => e.id),
      experimentIds,
    )
  ) {
    throw new RunStoreError(
      `Run ${id} evaluated dataset ${stored.run.dataset.id} with experiments ${stored.run.experiments.map((e) => e.id).join(", ")}; it cannot resume dataset ${datasetId} with ${experimentIds.join(", ")}.`,
      "conflict",
    );
  }
  return stored;
}

const jobId = (caseId: string, experiment: string, epoch: number): string => JSON.stringify([caseId, experiment, epoch]);

function latestReusableRowPerJob(stored: StoredRun | undefined): Map<string, CaseResult> {
  return new Map((stored?.cases ?? []).map((row) => [jobId(row.caseId, row.experiment, row.epoch), row]));
}

async function disposeAll<T>(experiments: readonly Experiment<T>[]): Promise<{ readonly experiment: string; readonly error: unknown }[]> {
  const processors = [...new Map(experiments.map(([id, processor]) => [processor, id])).entries()];
  const settled = await Promise.allSettled(processors.map(([processor]) => Promise.resolve().then(() => processor.dispose?.())));
  return settled.flatMap((result, index) =>
    result.status === "rejected" ? [{ experiment: processors[index]?.[1] ?? "", error: result.reason }] : [],
  );
}

function withDisposalErrors(error: unknown, failures: readonly { readonly error: unknown }[]): unknown {
  if (!failures.length) return error;
  const disposalErrors = failures.map((failure) => failure.error);
  if (typeof error === "object" && error !== null && Object.isExtensible(error)) {
    Object.defineProperty(error, "disposalErrors", { value: disposalErrors, enumerable: true, configurable: true });
    return error;
  }
  return new AggregateError([error, ...disposalErrors], "The run failed and experiment disposal failed.");
}

/**
 * Run every case through every experiment with bounded concurrency and return the stored result.
 * Lanes share one cursor, and the first lane failure aborts the others. Rows interrupted by an abort
 * are dropped so a resume extracts them again. `dispose` runs once on success, failure and abort: on
 * success its failures become warnings; on failure the original error is thrown with `disposalErrors`
 * attached. Reporter failures become warnings, persisted after every hook ran.
 */
export async function runEval<T>(options: RunEvalOptions<T>): Promise<EvalResult> {
  const experiments = experimentEntries(options.experiments);
  const controller = new AbortController();
  const relay = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) relay();
  else options.signal?.addEventListener("abort", relay, { once: true });
  let disposal: ReturnType<typeof disposeAll> | undefined;
  const dispose = (): ReturnType<typeof disposeAll> => (disposal ??= disposeAll(experiments));
  try {
    return await execute(options, experiments, controller, dispose);
  } catch (error) {
    throw withDisposalErrors(error, await dispose());
  } finally {
    options.signal?.removeEventListener("abort", relay);
  }
}

async function execute<T>(
  options: RunEvalOptions<T>,
  experiments: readonly Experiment<T>[],
  controller: AbortController,
  dispose: () => ReturnType<typeof disposeAll>,
): Promise<EvalResult> {
  const signal = controller.signal;
  const warnings: string[] = [];
  const notify = async (hook: (reporter: Reporter) => void | Promise<void>): Promise<void> => {
    for (const reporter of options.reporters ?? [])
      try {
        await hook(reporter);
      } catch (error) {
        warnings.push(`Reporter ${reporter.id}: ${message(error)}`);
      }
  };
  if (options.baseline && !options.store) throw new RunStoreError("Baseline comparison requires a store.", "not-found");
  if (!experiments.length) throw new DatasetError("At least one experiment is required.");
  const concurrency = positive(options.concurrency ?? 1, "Concurrency");
  const epochs = positive(options.epochs ?? 1, "Epochs");
  const items = await selectCases(options);
  validateTruth(items, options.spec);
  const configured = experiments.map(([id, processor]) => ({
    id,
    processor,
    configHash: fingerprintOf({ id: processor.id, config: processor.config ?? null }),
  }));
  const metadata = configured.map(({ id, processor, configHash }) => ({
    id,
    configHash,
    ...(processor.config === undefined ? {} : { config: processor.config }),
  }));
  const resumed = options.resume
    ? await openResumed(
        options.store,
        options.resume,
        options.dataset.id,
        experiments.map(([id]) => id),
      )
    : undefined;
  for (const [id, processor] of experiments) {
    try {
      await processor.preflight?.({ signal });
    } catch (error) {
      throw new PreflightError(id, error);
    }
  }

  const git = options.git ?? resumed?.run.git;
  const run: RunInfo = {
    id: resumed?.run.id ?? globalThis.crypto.randomUUID(),
    status: "in-progress",
    startedAt: resumed?.run.startedAt ?? new Date().toISOString(),
    dataset: { id: options.dataset.id, size: items.length, fingerprint: datasetFingerprint(items) },
    spec: options.spec.info,
    experiments: metadata,
    epochs,
    ...(git ? { git } : {}),
  };
  buildResult({ run, cases: [], ...(options.metrics ? { metrics: options.metrics } : {}) });
  if (!resumed) await options.store?.createRun(run);
  await notify((reporter) => reporter.onRunStart?.(run));

  const jobs: Job<T>[] = items.flatMap((item) =>
    configured.flatMap(({ id, processor, configHash }) =>
      Array.from({ length: epochs }, (_, epoch) => ({ item, processor, key: { experiment: id, configHash, epoch } })),
    ),
  );
  const previous = latestReusableRowPerJob(resumed);
  const fingerprints = new Map(items.map((item) => [item.id, caseFingerprint(item)]));
  const fingerprintFor = (item: EvalCase<T>): string => fingerprints.get(item.id) ?? caseFingerprint(item);
  const started = Date.now();

  const score = async (job: Job<T>, stored: StoredRaw, base: RowBase): Promise<CaseResult> => {
    try {
      return await scoredRow(options.spec, job.item.expected, job.item.locations, stored, job.processor.project?.bind(job.processor), base);
    } catch (error) {
      return erroredRow(
        options.spec,
        job.item.expected,
        { name: error instanceof Error ? error.name : "Error", message: `Scoring failed: ${message(error)}` },
        base,
      );
    }
  };

  const store = options.store;
  const reuse = async (job: Job<T>): Promise<CaseResult | undefined> => {
    const row = previous.get(jobId(job.item.id, job.key.experiment, job.key.epoch));
    const fingerprint = fingerprintFor(job.item);
    if (
      !row ||
      !resumed ||
      !store ||
      row.outcome === "errored" ||
      row.caseFingerprint !== fingerprint ||
      row.configHash !== job.key.configHash
    )
      return undefined;
    const base = {
      ...rowMetadata(job.item, job.key, options.slices, fingerprint),
      ...signalsOf(row),
      startedAt: row.startedAt,
      ms: row.ms,
    };
    if (row.outcome === "skipped") return { ...base, outcome: "skipped", reason: row.reason };
    const stored = await store.readRaw(resumed.run.id, { caseId: job.item.id, experiment: job.key.experiment, epoch: job.key.epoch });
    if (!stored || stored.configHash !== job.key.configHash || stored.caseFingerprint !== fingerprint) return undefined;
    return score(job, stored, base);
  };

  const extract = async (job: Job<T>): Promise<CaseResult | undefined> => {
    const { item, processor, key } = job;
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const fingerprint = fingerprintFor(item);
    const metadata = rowMetadata(item, key, options.slices, fingerprint);
    let output: unknown;
    try {
      output = await processor.extract(item, { signal, epoch: key.epoch, experiment: key.experiment });
    } catch (error) {
      if (signal.aborted) return undefined;
      const base = { ...metadata, startedAt, ms: Date.now() - start };
      if (error instanceof OutOfScopeError) return { ...base, outcome: "skipped", reason: error.reason };
      const original = error instanceof PricedExtractionFailure ? error.cause : error;
      const code =
        typeof original === "object" && original !== null && "code" in original && typeof original.code === "string"
          ? { code: original.code }
          : {};
      const usage = parseFailureUsage(error);
      const failure = {
        name: original instanceof Error ? original.name : "Error",
        ...code,
        message: usage.ok ? message(error) : `${message(error)} (usage ignored: ${usage.problem})`,
      };
      return erroredRow(options.spec, item.expected, failure, usage.ok && usage.value ? { ...base, usage: usage.value } : base);
    }
    const ms = Date.now() - start;
    const parsed = parseProcessorOutput(output);
    if (!parsed.ok)
      return erroredRow(
        options.spec,
        item.expected,
        { name: "InvalidOutput", message: `Processor ${key.experiment} returned invalid output for case ${item.id}: ${parsed.problem}.` },
        { ...metadata, startedAt, ms },
      );
    const stored = { ...parsed.value.stored, caseFingerprint: fingerprint, configHash: key.configHash };
    const row = await score(job, stored, { ...metadata, ...parsed.value.signals, startedAt, ms });
    if (store && row.outcome === "scored")
      await store.writeRaw(run.id, { caseId: item.id, experiment: key.experiment, epoch: key.epoch }, stored);
    return row;
  };

  const rows = new Map<number, CaseResult>();
  let cursor = 0;
  let completed = 0;
  const outcomes = { scored: 0, errored: 0, skipped: 0 };
  const lane = async (): Promise<void> => {
    while (!signal.aborted) {
      const index = cursor++;
      const job = jobs[index];
      if (!job) break;
      const reused = await reuse(job);
      const produced = reused ?? (await extract(job));
      if (!produced) continue;
      const row = withValues(run, produced, options.metrics);
      if (!reused) await store?.appendCase(run.id, row);
      rows.set(index, row);
      completed++;
      outcomes[row.outcome]++;
      await notify((reporter) => reporter.onCase?.(row, { completed, total: jobs.length, ...outcomes, elapsedMs: Date.now() - started }));
    }
  };
  const laneFailed = (error: unknown): never => {
    controller.abort(error);
    throw error;
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, jobs.length) }, () => lane().catch(laneFailed)));
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;

  for (const { experiment, error } of await dispose()) warnings.push(`Disposing experiment ${experiment} failed: ${message(error)}`);
  const status = options.signal?.aborted ? "aborted" : "complete";
  let result = await finishResult(
    options.store,
    { ...run, status, finishedAt: new Date().toISOString() },
    [...rows].sort(([a], [b]) => a - b).map(([, row]) => row),
    warnings,
    options,
  );
  await notify((reporter) => reporter.onResult(result));
  const late = warnings.filter((warning) => !result.warnings.includes(warning));
  if (late.length) {
    result = { ...result, warnings: [...result.warnings, ...late] };
    await options.store?.finalize(result);
  }
  return result;
}
