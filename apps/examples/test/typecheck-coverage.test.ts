import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
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
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .map((entry) => entry.name);

  expect(listed.status).toBe(0);
  expect(examples).toContain("01-quick-start");
  expect([...examples, "shared", "test"].filter((folder) => !checked.has(folder))).toEqual([]);
});
