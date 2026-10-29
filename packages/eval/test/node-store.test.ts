import { execFile } from "node:child_process";
import { appendFile, cp, mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { fileRunStore, folderDataset, jsonlDataset, fileDocument, gitInfo, readEvalResult, runDirectory, writeEvalResult } from "../src/node/index.js";
import { runEval, rescore } from "../src/runner/index.js";
import { inMemoryDataset, looseEval, defineEval, RunStoreError } from "../src/index.js";
import type { Dataset } from "../src/index.js";
const dirs: string[] = [];
async function temporary() { const dir = await mkdtemp(join(tmpdir(), "docture-eval-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it("round trips results and collision-free raw paths while preserving index history", async () => {
  const dir = await temporary(); const store = fileRunStore(dir); let calls = 0;
  const dataset = inMemoryDataset("disk", ["a/b", "a_b", "..", "é"].map(id => ({ id, documents: [], expected: { total: 1 } })));
  const result = await runEval({ dataset, spec: looseEval(), experiments: { id: "../processor", async extract(item) { calls++; return { raw: { total: 2, id: item.id } }; }, project: raw => raw }, store });
  expect((await store.readResult(result.run.id))).toEqual(result);
  for (const row of result.cases) expect((await store.readRaw(result.run.id, row))?.raw).toEqual({ total: 2, id: row.caseId });
  const before = await readFile(join(dir, "index.jsonl"), "utf8");
  expect(before.trim().split("\n")).toHaveLength(2);
  const rescored = await rescore(store, result.run.id, looseEval(), { extractors: { "../processor": { project: () => ({ total: 1 }) } } });
  expect(rescored.summary["../processor"]?.overall.f1).toBe(1); expect(calls).toBe(4);
  expect(await store.readResult(rescored.run.id)).toEqual(rescored); expect(rescored.run.rescoredFrom).toBe(result.run.id);
  const after = await readFile(join(dir, "index.jsonl"), "utf8"); expect(after.startsWith(before)).toBe(true);
  expect(after.trim().split("\n")).toHaveLength(4); expect((await store.listRuns()).map(entry => entry.id)).toEqual([result.run.id, rescored.run.id]);
  const persisted = (await readFile(join(dir, "runs", rescored.run.id, "cases.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(persisted[0].values.f1).toBe(1);
});
it("enforces missing-document, missing-truth, draft, include and sign-off rules", async () => {
  const root = await temporary(); const dir = join(root, "case"); await mkdir(dir);
  const options = { documents: "doc.pdf", expected: "expected.json" };
  const dataset = folderDataset(root, options);
  await expect(dataset.cases()).rejects.toThrow("missing document");
  await writeFile(join(dir, "doc.pdf"), "pdf");
  await expect(dataset.cases()).rejects.toThrow("missing expected");
  await dataset.writeExpected("case", { total: 7 }, { draft: true });
  await expect(dataset.cases()).rejects.toThrow("sign-off");
  expect(await folderDataset(root, { ...options, drafts: "skip" }).cases()).toEqual([]);
  expect((await folderDataset(root, { ...options, drafts: "include" }).cases())[0]).toMatchObject({ status: "draft", expected: { total: 7 } });
  await dataset.signOff("case");
  expect((await dataset.cases())[0]).toMatchObject({ status: "signed-off", expected: { total: 7 } });
  await dataset.writeExpected("case", { total: 8 }, { draft: true });
  await expect(dataset.signOff("case")).rejects.toThrow("no existing expected");
  await expect(folderDataset(root, { ...options, include: ["unknown"] }).cases()).rejects.toThrow("unknown");
  expect(await fileDocument(join(dir, "doc.pdf")).bytes()).toEqual(Buffer.from("pdf"));
  expect(fileDocument("x.pdf").mimeType).toBe("application/pdf");
});
it("runs a manifest plus separate truth-directory adapter", async () => {
  const root = await temporary(); await mkdir(join(root, "truth"));
  await writeFile(join(root, "source.txt"), "total 42"); await writeFile(join(root, "truth", "invoice.json"), '{"total":42}');
  await writeFile(join(root, "manifest.json"), JSON.stringify([{ key: "invoice", source: "source.txt" }]));
  const dataset: Dataset = { id: "custom", async cases() {
    const entries: { key: string; source: string }[] = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    return Promise.all(entries.map(async entry => ({ id: entry.key, documents: [fileDocument(join(root, entry.source))], expected: JSON.parse(await readFile(join(root, "truth", `${entry.key}.json`), "utf8")) })));
  } };
  const result = await runEval({ dataset, spec: looseEval(), experiments: { id: "p", async extract(item) { expect(await item.documents[0]?.bytes()).toEqual(Buffer.from("total 42")); return { raw: { total: 42 } }; } } });
  expect(result.summary.p?.overall.f1).toBe(1);
  await writeFile(join(root, "manifest.jsonl"), JSON.stringify({ id: "invoice", documents: ["source.txt"], expected: { total: 42 }, tags: { issuer: "test" } }) + "\n");
  expect((await jsonlDataset(join(root, "manifest.jsonl")).cases())[0]).toMatchObject({ id: "invoice", expected: { total: 42 }, tags: { issuer: "test" } });
  expect(await gitInfo(root)).toBeUndefined();
});
it("reports all invalid ground-truth cases before any extraction", async () => {
  const spec = defineEval({ type: "object", properties: { total: { type: "number" } }, required: ["total"], additionalProperties: false });
  let calls = 0;
  await expect(runEval({ dataset: inMemoryDataset("bad", [{ id: "one", documents: [], expected: { total: "bad" } }, { id: "two", documents: [], expected: { total: "also bad" } }]), spec, experiments: { id: "p", async extract() { calls++; return { raw: {} }; } } })).rejects.toThrow(/one[\s\S]*two/u);
  expect(calls).toBe(0);
});
it("opens unfinished file runs and resumes aborted ones without repeated extraction", async () => {
  const dir = await temporary(); const store = fileRunStore(dir); const controller = new AbortController(); let calls = 0;
  const dataset = inMemoryDataset("resume", Array.from({ length: 5 }, (_, i) => ({ id: String(i), documents: [], expected: i })));
  const processor = { id: "p", async extract(item: { expected: unknown }) { calls++; if (calls === 2) controller.abort(); return { raw: item.expected }; } };
  const first = await runEval({ dataset, spec: looseEval(), experiments: processor, signal: controller.signal, store });
  expect((await fileRunStore(dir).openRun(first.run.id)).cases).toHaveLength(2);
  const resumed = await runEval({ dataset, spec: looseEval(), experiments: processor, store: fileRunStore(dir), resume: "latest" });
  expect(calls).toBe(5); expect(resumed.cases).toHaveLength(5);
  const pending = { ...resumed.run, id: "unfinished", status: "in-progress" as const };
  await store.createRun(pending); await store.appendCase("unfinished", resumed.cases[0]!);
  expect(await store.openRun("unfinished")).toEqual({ run: pending, cases: [resumed.cases[0]] });
});

describe("fileRunStore raw outputs", () => {
  it("keeps ids that differ only in letter case apart on a case-insensitive filesystem", async () => {
    const dir = await temporary(); const store = fileRunStore(dir);
    const dataset = inMemoryDataset("x", ["abc", "abI", "ABC"].map(id => ({ id, documents: [], expected: { id } })));
    const result = await runEval({ dataset, spec: looseEval(), store, experiments: { id: "P", async extract(item) { return { raw: { id: item.id } }; } } });
    const rescored = await rescore(store, result.run.id, looseEval());
    expect(rescored.cases.map(row => row.outcome === "scored" ? row.actual : null)).toEqual([{ id: "abc" }, { id: "abI" }, { id: "ABC" }]);
  });

  it("stores raw output for ids longer than a file name allows", async () => {
    const dir = await temporary(); const store = fileRunStore(dir);
    const ids = ["x".repeat(300), `${"x".repeat(299)}y`, "é".repeat(200)];
    const result = await runEval({ dataset: inMemoryDataset("x", ids.map(id => ({ id, documents: [], expected: { n: id.length } }))), spec: looseEval(), store, experiments: { id: "e".repeat(300), async extract(item) { return { raw: { id: item.id } }; } } });
    const rescored = await rescore(store, result.run.id, looseEval());
    expect(rescored.cases.map(row => row.outcome === "scored" ? row.actual : null)).toEqual(ids.map(id => ({ id })));
  });
});

describe("fileRunStore logs", () => {
  async function crashedRun() {
    const dir = await temporary(); const store = fileRunStore(dir);
    const dataset = inMemoryDataset("x", [{ id: "a", documents: [], expected: 1 }, { id: "b", documents: [], expected: 2 }]);
    const processor = { id: "p", async extract(item: { expected: unknown }) { return { raw: item.expected }; } };
    await expect(runEval({ dataset, spec: looseEval(), store: { ...store, async finalize() { throw new Error("crash"); } }, experiments: processor })).rejects.toThrow("crash");
    const id = (await store.listRuns())[0]?.id ?? "";
    return { dir, store, dataset, processor, id };
  }

  it("ignores a torn final line left by a crash and appends after it", async () => {
    const { dir, store, dataset, processor, id } = await crashedRun();
    await appendFile(join(dir, "runs", id, "cases.jsonl"), '{"caseId":"c","outc');
    await appendFile(join(dir, "index.jsonl"), '{"id":"tor');
    expect((await store.openRun(id)).cases.map(row => row.caseId)).toEqual(["a", "b"]);
    expect((await store.listRuns()).map(entry => entry.id)).toEqual([id]);
    const crashing = fileRunStore(dir);
    await crashing.appendCase(id, (await store.openRun(id)).cases[0]!);
    expect((await crashing.openRun(id)).cases.map(row => row.caseId)).toEqual(["a", "b", "a"]);
    const resumed = await runEval({ dataset, spec: looseEval(), store: fileRunStore(dir), experiments: processor, resume: id });
    expect(resumed.run.status).toBe("complete");
    expect((await fileRunStore(dir).listRuns()).map(entry => entry.status)).toEqual(["complete"]);
  });

  it("fails on a corrupt line before the last one", async () => {
    const { dir, store, id } = await crashedRun();
    const path = join(dir, "runs", id, "cases.jsonl");
    const lines = (await readFile(path, "utf8")).split("\n");
    await writeFile(path, ["{broken", ...lines].join("\n"));
    const error = await store.openRun(id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunStoreError);
    expect(error).toMatchObject({ reason: "format" });
  });

  it("round trips a result through writeEvalResult and readEvalResult", async () => {
    const dir = await temporary();
    const result = await runEval({ dataset: inMemoryDataset("x", [{ id: "a", documents: [], expected: { total: 1 } }]), spec: looseEval(), experiments: { id: "p", async extract() { return { raw: { total: 2 }, usage: { inputTokens: 3 } }; } } });
    await writeEvalResult(dir, result);
    expect(await readEvalResult(dir)).toEqual(result);
    expect((await readdir(dir)).sort()).toEqual(["cases.jsonl", "result.json"]);
  });
});

describe("gitInfo", () => {
  const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", args, { cwd });
  it("reports a detached head as detached at its commit and counts untracked files as dirty", async () => {
    const dir = await temporary();
    await git(dir, "init", "-q", "-b", "trunk");
    await writeFile(join(dir, "a.txt"), "a");
    await git(dir, "add", "a.txt");
    await git(dir, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "a");
    const sha = (await git(dir, "rev-parse", "HEAD")).stdout.trim();
    expect(await gitInfo(dir)).toEqual({ branch: "trunk", sha, dirty: false });
    await writeFile(join(dir, "untracked.txt"), "b");
    expect(await gitInfo(dir)).toEqual({ branch: "trunk", sha, dirty: true });
    await git(dir, "checkout", "-q", "--detach");
    expect(await gitInfo(dir)).toEqual({ branch: `detached@${sha.slice(0, 12)}`, sha, dirty: true });
  });
});

it("re-scores a run directory copied out of its store into another store", async () => {
  const origin = await temporary(); const exported = join(await temporary(), "run"); const target = await temporary();
  const dataset = inMemoryDataset("disk", [{ id: "Case-A", documents: [], expected: { total: 10 } }]);
  const source = await runEval({ dataset, spec: looseEval({ numericTolerance: 1 }), store: fileRunStore(origin), experiments: { id: "p", async extract() { return { raw: { total: 10.4 } }; } } });
  expect(source.summary.p?.overall.f1).toBe(1);
  await cp(join(origin, "runs", source.run.id), exported, { recursive: true });
  await rm(origin, { recursive: true, force: true });
  const directory = runDirectory(exported);
  expect(await directory.readResult(source.run.id)).toEqual(source);
  await expect(directory.readResult("another-run")).rejects.toMatchObject({ reason: "not-found" });
  const store = fileRunStore(target);
  const rescored = await rescore(store, source.run.id, looseEval({ numericTolerance: 0 }), { source: directory });
  expect(rescored.run.rescoredFrom).toBe(source.run.id);
  expect(rescored.summary.p?.overall.f1).toBe(0);
  expect(await store.readResult(rescored.run.id)).toEqual(rescored);
  expect((await store.listRuns()).map(entry => entry.id)).toEqual([rescored.run.id]);
});
