import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseEvalResult } from "../../src/index.js";
import { jsonReporter, renderJson } from "../../src/reporters/json/index.js";
import { validateJsonSchema } from "../support/json-schema.js";
import { savedResult } from "./fixture.js";

const schema = JSON.parse(readFileSync(new URL("../../schemas/result-v1.schema.json", import.meta.url), "utf8")) as Record<string, unknown>;
const directories: string[] = [];
const temporary = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "eval-json-"));
  directories.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("json reporter", () => {
  it("renders a single document that the published schema accepts", () => {
    const json = JSON.parse(renderJson(savedResult())) as unknown;
    expect(validateJsonSchema(schema, json)).toEqual([]);
    expect(parseEvalResult(json)).toEqual(savedResult());
  });

  it("writes the single layout to one file", async () => {
    const out = join(await temporary(), "nested", "result.json");
    await jsonReporter({ out }).onResult(savedResult());
    expect(parseEvalResult(JSON.parse(await readFile(out, "utf8")))).toEqual(savedResult());
  });

  it("writes the split layout as result.json without cases plus one case per line", async () => {
    const dir = await temporary();
    await jsonReporter({ out: `${dir}/`, layout: "split" }).onResult(savedResult());
    const metadata = JSON.parse(await readFile(join(dir, "result.json"), "utf8")) as Record<string, unknown>;
    const lines = (await readFile(join(dir, "cases.jsonl"), "utf8")).split("\n");
    expect("cases" in metadata).toBe(false);
    expect(lines).toHaveLength(8);
    expect(lines[7]).toBe("");
    const cases = lines.slice(0, 7).map((line) => JSON.parse(line) as unknown);
    expect(validateJsonSchema(schema, { ...metadata, cases })).toEqual([]);
    expect(parseEvalResult({ ...metadata, cases })).toEqual(savedResult());
  });
});
