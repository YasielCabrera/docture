import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

it("convert selects original page numbers and describes them in a dry run", async () => {
  const cwd = await tempDir("convert-selected-pages");
  await writeFixture(cwd, "input.pdf", "%PDF-1.7 test");
  await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["FIRST PAGE", "SECOND PAGE", "THIRD PAGE"], ""));
  const args = ["convert", "input.pdf", "--out", "out", "--to", "json", "--pages", "3,2,3"];
  const result = await cli(args, { cwd });
  expect(result.code, result.stderr).toBe(0);
  const document: { pages: { pageNumber: number; elements: { text?: string }[] }[] } = JSON.parse(await readFile(join(cwd, "out/input.json"), "utf8"));
  expect(document.pages.map((page) => page.pageNumber)).toEqual([2, 3]);
  expect(JSON.stringify(document)).not.toContain("FIRST PAGE");
  const plan = await cli([...args, "--dry-run"], { cwd });
  expect(plan.code, plan.stderr).toBe(0);
  expect(plan.stdout).toContain('"pages": [');
  expect(JSON.parse(plan.stdout).results[0].plan.pages).toEqual([2, 3]);
});

it.each(["", "0", "-1", "1.5", "2,", "1e2", "x"])("rejects invalid --pages %j before config loading", async (pages) => {
  const cwd = await tempDir("convert-invalid-pages");
  await writeFixture(cwd, "docture.config.mjs", 'throw new Error("CONFIG MUST NOT LOAD");');
  const result = await cli(["convert", "input.pdf", "--out", "out", `--pages=${pages}`], { cwd });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("--pages");
  expect(result.stderr).not.toContain("CONFIG MUST NOT LOAD");
});
