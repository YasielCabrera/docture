import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { silentLogger } from "docture";
import { DocumentLoaderMuPdf } from "docture/loaders/mupdf";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const root = new URL("../", import.meta.url);
const sources = z.array(z.object({
  name: z.string(),
  source: z.url(),
  sha256: z.string().length(64),
  pages: z.number().int().positive(),
  text: z.string(),
})).parse(JSON.parse(await readFile(new URL("sources.json", root), "utf8")));
const folders = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/index.ts`, root)));

describe("bundled example documents", () => {
  it("includes a local PDF in each PDF-based example", async () => {
    for (const folder of folders) {
      if (["docling", "synthetic-corpus", "testing-your-pipeline"].includes(folder.name)) continue;
      const files = await readdir(new URL(`${folder.name}/`, root));
      expect(files.some((file) => file.endsWith(".pdf")), folder.name).toBe(true);
    }
  });

  it("keeps approved PDFs unchanged and verifies their actual pages and text layers", async () => {
    const seen = new Set<string>();
    const loader = new DocumentLoaderMuPdf();
    for (const folder of folders) {
      for (const file of await readdir(new URL(`${folder.name}/`, root))) {
        if (!file.endsWith(".pdf")) continue;
        const path = new URL(`${folder.name}/${file}`, root);
        const bytes = await readFile(path);
        const hash = createHash("sha256").update(bytes).digest("hex");
        const source = sources.find((item) => item.sha256 === hash);
        if (source === undefined) {
          expect(["synthetic-corpus", "testing-your-pipeline"], `${folder.name}/${file}`).toContain(folder.name);
          continue;
        }
        if (seen.has(hash)) continue;
        seen.add(hash);
        const result = await loader.load({ bytes, mimeType: "application/pdf" }, {
          signal: AbortSignal.timeout(30_000), logger: silentLogger,
        });
        expect(result.pages, source.name).toHaveLength(source.pages);
        if (source.text === "") expect(result.text.trim(), source.name).toBe("");
        else expect(result.text, source.name).toContain(source.text);
        if (file === "mixed.pdf") {
          expect(result.pages.map((page) => page.text.trim() !== "")).toEqual([true, false, false]);
        }
      }
    }
    expect([...seen].sort()).toEqual(sources.map((source) => source.sha256).sort());
  });
});
