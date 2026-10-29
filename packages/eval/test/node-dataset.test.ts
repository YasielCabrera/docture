import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatasetError } from "../src/index.js";
import { defineMigration, draftExpected, runMigration } from "../src/dataset/index.js";
import { folderDataset, jsonlDataset } from "../src/node/index.js";

const dirs: string[] = [];
async function temporary(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "docture-eval-ds-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function caseDir(root: string, id: string, files: Readonly<Record<string, string>>): Promise<void> {
  await mkdir(join(root, id), { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, id, name), content);
}
const options = { documents: "doc.pdf", expected: "expected.json" };
const failure = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => undefined, (error: unknown) => error);

describe("folderDataset", () => {
  it("includes folders that start with an underscore and ignores dot folders", async () => {
    const root = await temporary();
    await caseDir(root, "_private", { "doc.pdf": "a", "expected.json": "1" });
    await caseDir(root, ".cache", { "doc.pdf": "a", "expected.json": "1" });
    expect((await folderDataset(root, options).cases()).map(item => item.id)).toEqual(["_private"]);
  });

  it("reports a missing root or case directory as a dataset error", async () => {
    const root = await temporary();
    const missingRoot = await failure(folderDataset(join(root, "absent"), options).cases());
    expect(missingRoot).toBeInstanceOf(DatasetError);
    const missingCase = await failure(folderDataset(root, options).writeExpected("absent", 1, { draft: true }));
    expect(missingCase).toBeInstanceOf(DatasetError);
    expect(missingCase).toMatchObject({ caseId: "absent" });
  });

  it("loads document bytes only when asked", async () => {
    const root = await temporary();
    await caseDir(root, "a", { "doc.pdf": "first", "expected.json": "1" });
    const [item] = await folderDataset(root, options).cases();
    await writeFile(join(root, "a", "doc.pdf"), "second");
    expect(Buffer.from(await item!.documents[0]!.bytes()).toString()).toBe("second");
  });

  it("lists cases without signed-off truth and drafts them end to end", async () => {
    const root = await temporary();
    await caseDir(root, "new", { "doc.pdf": "a" });
    await caseDir(root, "drafted", { "doc.pdf": "a", "expected.draft.json": '{"total":1}' });
    await caseDir(root, "signed", { "doc.pdf": "a", "expected.json": '{"total":1}' });
    const dataset = folderDataset<{ total: number }>(root, { ...options, include: ["new", "drafted", "signed"] });
    expect((await dataset.pendingCases()).map(item => item.id)).toEqual(["drafted", "new"]);
    const drafted = await draftExpected(dataset, { id: "p", async extract() { return { raw: { total: 5 } }; } });
    expect(drafted).toEqual(["drafted", "new"]);
    expect(JSON.parse(await readFile(join(root, "new", "expected.draft.json"), "utf8"))).toEqual({ total: 5 });
    expect(JSON.parse(await readFile(join(root, "signed", "expected.json"), "utf8"))).toEqual({ total: 1 });
    expect(await readdir(join(root, "signed"))).toEqual(["doc.pdf", "expected.json"]);
  });

  it("keeps a migrated draft a draft", async () => {
    const root = await temporary();
    await caseDir(root, "case", { "doc.pdf": "a", "expected.draft.json": '{"total":1}' });
    await runMigration(folderDataset(root, { ...options, drafts: "include" }), defineMigration({ id: "m", description: "", targets: ["total"], apply: () => ({ total: 2 }) }), { write: true });
    expect((await readdir(join(root, "case"))).sort()).toEqual(["doc.pdf", "expected.draft.json"]);
    expect(JSON.parse(await readFile(join(root, "case", "expected.draft.json"), "utf8"))).toEqual({ total: 2 });
  });

  it("reads expected locations from a case's locations file when present", async () => {
    const root = await temporary();
    const locations = { total: [{ pageNumber: 2, box: { x: 10, y: 20, width: 30, height: 8 } }], "items[0].sku": [{ pageNumber: 1 }] };
    await caseDir(root, "located", { "doc.pdf": "a", "expected.json": "1", "where.json": JSON.stringify(locations) });
    await caseDir(root, "plain", { "doc.pdf": "a", "expected.json": "1" });
    const cases = await folderDataset(root, { ...options, locations: "where.json" }).cases();
    expect(cases.map(item => [item.id, item.locations])).toEqual([["located", locations], ["plain", undefined]]);
  });

  it("names the case of a locations file with a bad page number", async () => {
    const root = await temporary();
    await caseDir(root, "a", { "doc.pdf": "a", "expected.json": "1", "locations.json": '{"total":[{"pageNumber":0}]}' });
    const error = await failure(folderDataset(root, options).cases());
    expect(error).toBeInstanceOf(DatasetError);
    expect(error).toMatchObject({ caseId: "a", message: "a: locations.json at total needs a positive integer pageNumber." });
  });
});

describe("jsonlDataset", () => {
  async function manifest(lines: readonly string[]): Promise<string> {
    const root = await temporary();
    await writeFile(join(root, "doc.pdf"), "a");
    const path = join(root, "manifest.jsonl");
    await writeFile(path, lines.join("\n") + "\n");
    return path;
  }
  const row = (fields: Readonly<Record<string, unknown>>): string => JSON.stringify({ id: "a", documents: ["doc.pdf"], expected: 1, ...fields });

  it("names the line of invalid JSON", async () => {
    const error = await failure(jsonlDataset(await manifest([row({}), "{not json"])).cases());
    expect(error).toBeInstanceOf(DatasetError);
    expect(error).toMatchObject({ message: "manifest.jsonl line 2: invalid JSON." });
  });

  it("names the line and case of a row without required members", async () => {
    const error = await failure(jsonlDataset(await manifest([row({ id: "b", expected: undefined })])).cases());
    expect(error).toBeInstanceOf(DatasetError);
    expect(error).toMatchObject({ caseId: "b", message: "manifest.jsonl line 1: rows require id, documents and expected." });
  });

  it("rejects array tags and params", async () => {
    for (const fields of [{ tags: ["scan"] }, { params: [1] }]) {
      const error = await failure(jsonlDataset(await manifest([row(fields)])).cases());
      expect(error).toBeInstanceOf(DatasetError);
      expect(error).toMatchObject({ caseId: "a" });
    }
  });

  it("rejects a missing document with its case id", async () => {
    const error = await failure(jsonlDataset(await manifest([row({ documents: ["absent.pdf"] })])).cases());
    expect(error).toBeInstanceOf(DatasetError);
    expect(error).toMatchObject({ caseId: "a", message: "manifest.jsonl line 1: missing document absent.pdf." });
  });
  it("reads each row's expected locations", async () => {
    const locations = { total: [{ pageNumber: 1, box: { x: 1.5, y: 2, width: 0, height: 9 } }, { pageNumber: 3 }] };
    const [item, other] = await jsonlDataset(await manifest([row({ locations }), row({ id: "b" })])).cases();
    expect(item?.locations).toEqual(locations);
    expect(other?.locations).toBeUndefined();
  });

  it("names the line of malformed locations", async () => {
    const cases: readonly [unknown, string][] = [
      [[1], "locations must be an object of location arrays"],
      [{ total: { pageNumber: 1 } }, "locations at total must be an array"],
      [{ total: [{ pageNumber: 1.5 }] }, "locations at total needs a positive integer pageNumber"],
      [{ total: [{ pageNumber: 1, box: { x: 0, y: 0, width: 5 } }] }, "locations at total needs a box of finite x, y, width and height"],
      [{ total: [{ pageNumber: 1, box: { x: 0, y: 0, width: -1, height: 2 } }] }, "locations at total needs a box with non-negative width and height"],
    ];
    for (const [locations, problem] of cases) {
      const error = await failure(jsonlDataset(await manifest([row({ id: "b" }), row({ locations })])).cases());
      expect(error).toBeInstanceOf(DatasetError);
      expect(error).toMatchObject({ caseId: "a", message: `manifest.jsonl line 2: ${problem}.` });
    }
  });
});
