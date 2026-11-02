import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DoclingServeClient } from "docture/loaders/docling";

export async function runExample(baseUrl = process.env["DOCLING_URL"]) {
  if (!baseUrl) throw new Error("Set DOCLING_URL to your running Docling Serve instance.");
  const client = new DoclingServeClient({ baseUrl });
  const bytes = await readFile(new URL("./invoice.pdf", import.meta.url));
  const result = await client.convert({ bytes, mimeType: "application/pdf", fileName: "invoice.pdf" });
  return { text: result.source.loaded.text, diagnostics: result.diagnostics };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runExample(), null, 2));
