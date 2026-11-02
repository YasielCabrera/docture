import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCheckedExtractor } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice, invoiceParser } from "./invoice.js";

export async function runExample() {
  await using extractor = createCheckedExtractor({
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [invoiceParser],
  });
  return await extractor.extract({ bytes: await readFile(new URL("./invoice.pdf", import.meta.url)), mimeType: "application/pdf" }, Invoice);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify((await runExample()).data, null, 2));
}
