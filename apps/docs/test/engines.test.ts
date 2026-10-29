import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { engineGroups } from "../lib/engines";

const packagesRoot = resolve(import.meta.dirname, "../../../packages");

async function publishedEntries(): Promise<Set<string>> {
  const entries = new Set<string>();
  for (const directory of await readdir(packagesRoot)) {
    const manifest = JSON.parse(await readFile(resolve(packagesRoot, directory, "package.json"), "utf8")) as {
      name: string;
      exports?: Record<string, unknown>;
    };
    entries.add(manifest.name);
    for (const key of Object.keys(manifest.exports ?? {})) {
      if (key !== ".") entries.add(`${manifest.name}/${key.slice(2)}`);
    }
  }
  return entries;
}

describe("home page engine list", () => {
  it("names only import specifiers a published package exports", async () => {
    const entries = await publishedEntries();
    const specifiers = engineGroups.flatMap((group) => group.engines.map((engine) => engine.specifier));

    expect(entries.has("docture/loaders/pdfjs")).toBe(true);
    expect(entries.has("docture/loaders/pdf")).toBe(false);
    expect(specifiers.filter((specifier) => !entries.has(specifier))).toEqual([]);
  });
});
