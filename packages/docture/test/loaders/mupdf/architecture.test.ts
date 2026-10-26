/**
 * The one design rule this package makes that is only true as long as something checks it:
 * `mupdf` is reached with `await import()` and never statically.
 *
 * It matters more here than for a normal dependency. Importing `mupdf` runs a top-level
 * `await` that instantiates its WASM module, so a single static import — the obvious thing
 * for someone to add while fixing something else — would move a multi-megabyte engine's
 * startup from "first document" to "merely importing this package", for every consumer,
 * including those who only wanted `DocumentLoaderMuPdfOptions`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../../../src/loaders/mupdf", import.meta.url));

async function sourceFiles(dir = srcDir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("mupdf is loaded lazily", () => {
  it("is never imported with a static import or require", async () => {
    const offenders: string[] = [];

    for (const file of await sourceFiles()) {
      const source = await readFile(file, "utf8");
      // Strip comments first: this package's prose says `import("mupdf")` a lot.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

      for (const pattern of [
        // A static import or re-export. `import type` is fine — it is erased.
        /^\s*(?:import|export)(?!\s+type\b)\b[^;]*?\bfrom\s*["']mupdf["']/gm,
        /^\s*import\s*["']mupdf["']/gm,
        /\brequire\s*\(\s*["']mupdf["']\s*\)/g,
      ]) {
        if (pattern.test(code)) offenders.push(relative(srcDir, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("is imported dynamically exactly once, from the module that owns the engine", async () => {
    const importers: string[] = [];

    for (const file of await sourceFiles()) {
      const code = (await readFile(file, "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/\bimport\s*\(\s*["']mupdf["']\s*\)/.test(code)) importers.push(relative(srcDir, file));
    }

    // One engine, one place that starts it — which is also what makes the log bridge and
    // the module cache single-instance.
    expect(importers).toEqual(["mupdf.ts"]);
  });
});
