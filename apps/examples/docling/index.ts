import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chunkDocument } from "docture/chunk";
import { importDoclingDocument } from "docture/import/docling";

export async function runExample() {
  const native: unknown = JSON.parse(await readFile(new URL("./report.json", import.meta.url), "utf8"));
  const imported = importDoclingDocument(native);
  const chunks = chunkDocument(imported.document, { budget: { unit: "characters", max: 200 } });
  return {
    text: imported.source.loaded.text,
    pages: imported.document.pages.length,
    chunks: chunks.map((chunk) => chunk.text),
    diagnostics: imported.diagnostics,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
