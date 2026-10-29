import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawKey, RunIndexEntry, RunStore, StoredRaw } from "../store.js";
import type { CaseResult, EvalResult, RunInfo } from "../result/types.js";
import { parseCaseResult, parseEvalResult, parseRunInfo } from "../result/parse.js";
import { isPlainObject, toJsonValue } from "../json.js";
import { RunStoreError } from "../errors.js";
import { parseStoredRaw } from "../runner/output.js";
import { runIndexEntry } from "../runner/store.js";
import { writeFileAtomic } from "./artifacts.js";

function parseStoredJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new RunStoreError("Stored artifact is not valid JSON.", "format", { cause });
  }
}

const MAX_HEX = 120;
// Hex survives case-insensitive filesystems; hashing long ids keeps names under the 255-byte limit.
function encoded(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  return hex.length <= MAX_HEX ? `x-${hex}` : `h-${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
const isMissing = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
async function optionalRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new RunStoreError(`Cannot read ${path}.`, "io", { cause: error });
  }
}
function completeLines(text: string | undefined): string[] {
  const lines = (text ?? "").split("\n");
  lines.pop();
  return lines.filter(Boolean);
}
async function rows(path: string): Promise<CaseResult[]> {
  return completeLines(await optionalRead(path)).map((line) => parseCaseResult(parseStoredJson(line)));
}
async function dropTornTail(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r+");
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return;
    const chunk = Buffer.alloc(Math.min(size, 64 * 1024));
    let end = size;
    while (end > 0) {
      const start = Math.max(0, end - chunk.length);
      const { bytesRead } = await handle.read(chunk, 0, end - start, start);
      const newline = chunk.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (newline !== -1) {
        if (start + newline + 1 !== size) await handle.truncate(start + newline + 1);
        return;
      }
      end = start;
    }
    await handle.truncate(0);
  } finally {
    await handle.close();
  }
}
function logAppender(): (path: string, line: string) => Promise<void> {
  const repaired = new Map<string, Promise<void>>();
  return async (path, line) => {
    let repair = repaired.get(path);
    if (!repair) {
      repair = dropTornTail(path);
      repaired.set(path, repair);
    }
    await repair;
    await appendFile(path, line + "\n");
  };
}
/** Read and validate the small metadata file and separate case rows. */
export async function readEvalResult(dir: string): Promise<EvalResult> {
  const text = await optionalRead(join(dir, "result.json"));
  if (text === undefined) throw new RunStoreError(`No result at ${dir}.`, "not-found");
  const metadata: unknown = parseStoredJson(text);
  if (typeof metadata !== "object" || metadata === null) return parseEvalResult(metadata);
  return parseEvalResult({ ...metadata, cases: await rows(join(dir, "cases.jsonl")) });
}
/** Replace case rows, then atomically write `result.json`, the commit point a reader checks first. Raw files remain available. */
export async function writeEvalResult(dir: string, result: EvalResult): Promise<void> {
  const { cases, ...metadata } = result;
  await writeFileAtomic(join(dir, "cases.jsonl"), cases.map((row) => JSON.stringify(row) + "\n").join(""));
  await writeFileAtomic(join(dir, "result.json"), JSON.stringify(metadata) + "\n");
}
function rawFile(runDir: string, key: RawKey): string {
  return join(runDir, "raw", encoded(key.experiment), `${encoded(key.caseId)}.${key.epoch}.json`);
}
async function readRawFile(path: string, key: RawKey): Promise<StoredRaw | undefined> {
  const text = await optionalRead(path);
  return text === undefined ? undefined : parseStoredRaw(parseStoredJson(text), `${key.experiment}/${key.caseId}/${key.epoch}`);
}

/**
 * One run directory read on its own, such as `runs/<runId>/` copied out of a store: its result and raw outputs,
 * for `rescore(store, runId, spec, { source })`. Reading another run id fails with `RunStoreError` (`not-found`).
 */
export function runDirectory(dir: string): Pick<RunStore, "readResult" | "readRaw"> {
  let stored: Promise<EvalResult> | undefined;
  const result = async (id: string): Promise<EvalResult> => {
    const read = await (stored ??= readEvalResult(dir));
    if (read.run.id !== id) throw new RunStoreError(`The run directory ${dir} holds run ${read.run.id}, not ${id}.`, "not-found");
    return read;
  };
  return {
    readResult: result,
    async readRaw(id, key) {
      await result(id);
      return readRawFile(rawFile(dir, key), key);
    },
  };
}

/**
 * A run store in a directory. `index.jsonl` is an append-only list of run events, and `runs/<runId>/` holds
 * `run.json`, `cases.jsonl`, `result.json` and `raw/<experiment>/<caseId>.<epoch>.json`. Each id in a raw path
 * is `x-` plus its UTF-8 bytes in lowercase hex, or `h-` plus their SHA-256 when longer than 60 bytes, so ids
 * that differ only in letter case never share a file. A crash can tear the last line of a log; readers ignore
 * it and the next append cuts it.
 */
export function fileRunStore(dir: string): RunStore {
  const runDir = (id: string): string => {
    if (!id || id === "." || id === ".." || /[/\\]/u.test(id)) throw new RunStoreError("Invalid run id.", "format");
    return join(dir, "runs", id);
  };
  const rawPath = (id: string, key: RawKey) => rawFile(runDir(id), key);
  const append = logAppender();
  const index = async (run: RunInfo, result?: EvalResult): Promise<void> => {
    await mkdir(dir, { recursive: true });
    await append(join(dir, "index.jsonl"), JSON.stringify(runIndexEntry(run, result)));
  };
  return {
    async createRun(run) {
      await mkdir(join(dir, "runs"), { recursive: true });
      try {
        await mkdir(runDir(run.id));
      } catch (cause) {
        throw new RunStoreError(`Cannot create run ${run.id}.`, "conflict", { cause });
      }
      await writeFileAtomic(join(runDir(run.id), "run.json"), JSON.stringify(run));
      await index(run);
    },
    async appendCase(id, row) {
      await append(join(runDir(id), "cases.jsonl"), JSON.stringify(row));
    },
    async writeRaw(id, key, value) {
      await writeFileAtomic(rawPath(id, key), JSON.stringify(toJsonValue(value)) + "\n");
    },
    async readRaw(id, key) {
      return readRawFile(rawPath(id, key), key);
    },
    async openRun(id) {
      const result = await optionalRead(join(runDir(id), "result.json"));
      if (result !== undefined) {
        const parsed = await readEvalResult(runDir(id));
        return { run: parsed.run, cases: parsed.cases };
      }
      const text = await optionalRead(join(runDir(id), "run.json"));
      if (!text) throw new RunStoreError(`Run ${id} not found.`, "not-found");
      const run: unknown = parseStoredJson(text);
      return { run: parseRunInfo(run), cases: await rows(join(runDir(id), "cases.jsonl")) };
    },
    async finalize(result) {
      await writeEvalResult(runDir(result.run.id), result);
      await index(result.run, result);
    },
    async listRuns() {
      const events = completeLines(await optionalRead(join(dir, "index.jsonl")));
      const entries = new Map<string, RunIndexEntry>();
      for (const event of events) {
        const value: unknown = parseStoredJson(event);
        if (!isPlainObject(value) || typeof value.id !== "string") throw new RunStoreError("Invalid run index.", "format");
        if (!isPlainObject(value.spec)) throw new RunStoreError("Invalid run index metadata.", "format");
        const { summary: _summary, ...metadata } = value;
        const parsed = parseEvalResult({
          format: "docture-eval-result",
          version: 1,
          run: { ...metadata, spec: { ...value.spec, fields: [], arrays: [] }, epochs: 1 },
          cases: [],
          metrics: [],
          summary: {},
          warnings: [],
          extensions: {},
        });
        const summary: Record<string, Record<string, number | null>> = {};
        if (value.summary !== undefined) {
          if (!isPlainObject(value.summary)) throw new RunStoreError("Invalid index summary.", "format");
          for (const [experiment, metrics] of Object.entries(value.summary)) {
            if (!isPlainObject(metrics)) throw new RunStoreError("Invalid index metrics.", "format");
            const values: Record<string, number | null> = {};
            for (const [name, metric] of Object.entries(metrics)) {
              if (metric !== null && (typeof metric !== "number" || !Number.isFinite(metric)))
                throw new RunStoreError("Invalid index metric value.", "format");
              values[name] = metric;
            }
            summary[experiment] = values;
          }
        }
        entries.set(value.id, { ...runIndexEntry(parsed.run), ...(value.summary === undefined ? {} : { summary }) });
      }
      return [...entries.values()];
    },
    async readResult(id) {
      return readEvalResult(runDir(id));
    },
  };
}
