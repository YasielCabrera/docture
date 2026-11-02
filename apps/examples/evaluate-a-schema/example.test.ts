import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { runExample } from "./index.js";

it("scores both real invoice layouts against independent truth files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docture-eval-example-"));
  const result = await runExample(pathToFileURL(`${directory}/`));
  expect(result.summary["parser"]?.cases).toEqual({ total: 2, scored: 2, errored: 0, skipped: 0 });
  expect(result.summary["parser"]?.overall["f1"]).toBe(1);
  expect(result.gate?.pass).toBe(true);
  expect(await readFile(join(directory, "report.md"), "utf8")).toContain("parser");
});
