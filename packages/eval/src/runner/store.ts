import { RunStoreError } from "../errors.js";
import type { RunStore, RunIndexEntry, RawKey, StoredRaw, StoredRun } from "../store.js";
import type { EvalResult, RunInfo } from "../result/types.js";

/** Build an index record from metadata and an optional finalized result. */
export function runIndexEntry(run: RunInfo, result?: EvalResult): RunIndexEntry {
  return {
    ...run,
    spec: { fingerprint: run.spec.fingerprint },
    ...(result ? { summary: Object.fromEntries(Object.entries(result.summary).map(([id, summary]) => [id, summary.overall])) } : {}),
  };
}
/** Create an isolated in-memory store, including raw outputs for re-scoring. */
export function memoryRunStore(): RunStore {
  const runs = new Map<string, StoredRun>();
  const results = new Map<string, EvalResult>();
  const raw = new Map<string, StoredRaw>();
  const key = (id: string, k: RawKey) => JSON.stringify([id, k.experiment, k.caseId, k.epoch]);
  const open = (id: string): StoredRun => {
    const run = runs.get(id);
    if (!run) throw new RunStoreError(`Run ${id} does not exist.`, "not-found");
    return run;
  };
  return {
    async createRun(run) {
      if (runs.has(run.id)) throw new RunStoreError(`Run ${run.id} exists.`, "conflict");
      runs.set(run.id, structuredClone({ run, cases: [] }));
    },
    async appendCase(id, row) {
      const old = open(id);
      runs.set(id, { ...old, cases: [...old.cases, structuredClone(row)] });
    },
    async openRun(id) {
      return structuredClone(open(id));
    },
    async writeRaw(id, k, value) {
      open(id);
      raw.set(key(id, k), structuredClone(value));
    },
    async readRaw(id, k) {
      const stored = raw.get(key(id, k));
      return stored === undefined ? undefined : structuredClone(stored);
    },
    async finalize(result) {
      open(result.run.id);
      results.set(result.run.id, structuredClone(result));
      runs.set(result.run.id, structuredClone({ run: result.run, cases: result.cases }));
    },
    async listRuns() {
      return [...runs.values()].map(({ run }) => runIndexEntry(run, results.get(run.id)));
    },
    async readResult(id) {
      const result = results.get(id);
      if (!result) throw new RunStoreError(`Run ${id} has no result.`, "not-found");
      return structuredClone(result);
    },
  };
}
