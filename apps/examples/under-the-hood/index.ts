import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readDocument, silentLogger } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice, invoiceParser } from "./invoice.js";

export async function runExample() {
  const bytes = await readFile(new URL("./invoice.pdf", import.meta.url));
  const loader = new DocumentLoaderPdfJs();
  const loaded = await readDocument(
    [loader],
    { bytes, mimeType: "application/pdf" },
    silentLogger,
    AbortSignal.timeout(30_000),
    undefined,
  );
  await using extractor = new Extractor({ loaders: [loader], strategies: [invoiceParser] });
  const source = { loaded: loaded.document };
  const result = await extractor.extract(source, Invoice);
  return { data: result.data, pages: loaded.document.pages.length, loader: loaded.document.loader };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
