import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function runExample(url = "http://127.0.0.1:3000") {
  const bytes = await readFile(new URL("./invoice.pdf", import.meta.url));
  const response = await fetch(`${url}/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "invoice",
      document: { data: bytes.toString("base64"), mimeType: "application/pdf", fileName: "invoice.pdf" },
    }),
  });
  if (!response.ok) throw new Error(`Extraction failed with HTTP ${response.status}: ${await response.text()}`);
  const result: unknown = await response.json();
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runExample(), null, 2));
