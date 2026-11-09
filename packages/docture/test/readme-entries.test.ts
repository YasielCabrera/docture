import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("lists every published subpath in the README entry table", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, unknown> };
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const listed = new Set([...readme.matchAll(/^\| `(docture(?:\/[^`]+)?)` \|/gm)].map((match) => match[1]));
  const entries = Object.keys(manifest.exports)
    .filter((key) => key !== "./package.json")
    .map((key) => (key === "." ? "docture" : `docture/${key.slice(2)}`));
  expect(entries.filter((entry) => !listed.has(entry))).toEqual([]);
});
