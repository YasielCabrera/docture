import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

it("type-checks a source file from every example folder", async () => {
  const listed = spawnSync(fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url)), ["-p", "tsconfig.json", "--listFilesOnly"], {
    cwd: root,
    encoding: "utf8",
  });
  const checked = new Set(
    listed.stdout
      .split("\n")
      .filter((file) => file !== "")
      .map((file) => relative(root, realpathSync(file)))
      .filter((file) => !file.startsWith(".."))
      .map((file) => file.split(sep)[0]),
  );
  const examples = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`../${entry.name}/index.ts`, import.meta.url)))
    .map((entry) => entry.name);

  expect(listed.status).toBe(0);
  expect(examples).toContain("quick-start");
  expect([...examples, "test"].filter((folder) => !checked.has(folder))).toEqual([]);
});
