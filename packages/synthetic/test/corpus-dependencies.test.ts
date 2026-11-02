import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { defineModel, defineTemplate, gen, locales, type DependencyInputs } from "../src/index.js";
import { writeCorpus } from "../src/node/index.js";
import { z } from "zod";

const Schema = z.object({ name: z.string() });
const template = defineTemplate<z.infer<typeof Schema>>()({
  key: "customer", family: "test", locale: locales["de-DE"], printed: { name: true },
  draw(page, value) { page.field("name", value.name, { x: 40, y: 40 }); },
});
const directories: string[] = [];
const temporary = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "docture-dependencies-"));
  directories.push(path);
  return path;
};
afterAll(async () => { await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true }))); });

const model = (name: string, dependencies?: DependencyInputs) => defineModel(Schema, {
  fields: { name: gen.from(() => name) },
  ...(dependencies === undefined ? {} : { dependencies }),
});

describe("corpus dependency provenance", () => {
  it("rewrites the same case when captured model inputs change and records only hashes", async () => {
    const directory = await temporary();
    const plan = { templates: [template], seeds: [1], createdAt: "2025-01-01T00:00:00Z" };
    const first = { ...plan, model: model("Alice", { customer: "Alice", policy: { b: 2, a: 1 } }) };
    expect(await writeCorpus(directory, first)).toMatchObject({ written: 1, skipped: 0, failed: [] });
    const changedOrder = { ...plan, model: model("Alice", { policy: { a: 1, b: 2 }, customer: "Alice" }) };
    expect(await writeCorpus(directory, changedOrder)).toMatchObject({ written: 0, skipped: 1 });
    const changedData = { ...plan, model: model("Bob", { customer: "Bob", policy: { a: 1, b: 2 } }) };
    expect(await writeCorpus(directory, changedData)).toMatchObject({ written: 1, skipped: 0 });
    expect(JSON.parse(await readFile(join(directory, "cases/customer-base-1-digital/expected.json"), "utf8"))).toEqual({ name: "Bob" });
    const summary = JSON.parse(await readFile(join(directory, "corpus.json"), "utf8"));
    expect(summary.dependencies.model.customer).toMatch(/^[a-f0-9]{64}$/u);
    expect(summary.dependencies.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(summary.dependencies)).not.toContain("Bob");
    expect(summary.engines).toMatchObject({ "@faker-js/faker": "10.6.0", ai: "7.0.51" });
  });

  it("tracks changed bytes and helper revisions while equivalent declarations skip", async () => {
    const directory = await temporary();
    const plan = { model: model("Alice"), templates: [template], seeds: [7], createdAt: "2025-01-01T00:00:00Z" };
    expect(await writeCorpus(directory, { ...plan, dependencies: { logo: new Uint8Array([1, 2]), rules: "v1" } })).toMatchObject({ written: 1 });
    expect(await writeCorpus(directory, { ...plan, dependencies: { rules: "v1", logo: new Uint8Array([1, 2]) } })).toMatchObject({ skipped: 1, written: 0 });
    expect(await writeCorpus(directory, { ...plan, dependencies: { rules: "v1", logo: new Uint8Array([1, 3]) } })).toMatchObject({ written: 1, skipped: 0 });
    expect(await writeCorpus(directory, { ...plan, dependencies: { rules: "v2", logo: new Uint8Array([1, 3]) } })).toMatchObject({ written: 1, skipped: 0 });
  });

  it("rejects invalid declared inputs before touching an existing corpus", async () => {
    const directory = await temporary();
    await writeFile(join(directory, "keep.txt"), "intact");
    const plan = { model: model("Alice"), templates: [template], seeds: [1] };
    await expect(writeCorpus(directory, { ...plan, dependencies: { bad: Number.NaN } })).rejects.toThrow(/finite/u);
    expect(await readdir(directory)).toEqual(["keep.txt"]);
    expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("intact");
  });
});
