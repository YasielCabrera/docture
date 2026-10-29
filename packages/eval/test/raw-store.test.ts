import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunStoreError, type RunStore, type StoredRaw } from "../src/index.js";
import { fileRunStore } from "../src/node/index.js";
import { memoryRunStore } from "../src/runner/index.js";
import { runInfo } from "./support/run.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function temporary(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "docture-raw-")); dirs.push(dir); return dir; }

const key = { experiment: "llm", caseId: "c1", epoch: 0 };
const output: StoredRaw = {
  raw: { total: 42, lines: [{ amount: 1 }] },
  confidence: { total: 0.9 },
  evidence: [{ path: "total", pageNumber: 2, box: { x: 1, y: 2, width: 3, height: 4 }, status: "verified" }],
  configHash: "cfg",
  caseFingerprint: "case",
};

const stores: readonly [string, () => Promise<RunStore>][] = [
  ["memoryRunStore", async () => memoryRunStore()],
  ["fileRunStore", async () => fileRunStore(await temporary())],
];

describe.each(stores)("%s raw outputs", (_name, create) => {
  it("returns the raw output with its confidence, evidence and job identity", async () => {
    const store = await create();
    await store.createRun(runInfo(["llm"]));
    await store.writeRaw("run-1", key, output);
    expect(await store.readRaw("run-1", key)).toEqual(output);
    expect(await store.readRaw("run-1", { ...key, epoch: 1 })).toBeUndefined();
  });

  it("returns only the raw member when nothing else was stored", async () => {
    const store = await create();
    await store.createRun(runInfo(["llm"]));
    await store.writeRaw("run-1", key, { raw: null });
    expect(await store.readRaw("run-1", key)).toEqual({ raw: null });
  });
});

describe("fileRunStore raw files", () => {
  it("writes one flat JSON envelope per job", async () => {
    const dir = await temporary();
    const store = fileRunStore(dir);
    await store.createRun(runInfo(["llm"]));
    await store.writeRaw("run-1", key, { raw: { total: 1 }, confidence: { total: 0.5 } });
    const file = join(dir, "runs", "run-1", "raw", "x-6c6c6d", "x-6331.0.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ raw: { total: 1 }, confidence: { total: 0.5 } });
  });

  it("rejects a stored envelope whose confidence is not a probability", async () => {
    const dir = await temporary();
    const store = fileRunStore(dir);
    await store.createRun(runInfo(["llm"]));
    await store.writeRaw("run-1", key, { raw: 1 });
    await writeFile(join(dir, "runs", "run-1", "raw", "x-6c6c6d", "x-6331.0.json"), JSON.stringify({ raw: 1, confidence: { total: 2 } }));
    const error = await store.readRaw("run-1", key).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunStoreError);
    expect(error).toMatchObject({ reason: "format", message: 'Stored raw output llm/c1/0 is invalid: confidence["total"] must be a number from 0 to 1.' });
  });
});
