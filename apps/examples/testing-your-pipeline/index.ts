import { fileURLToPath } from "node:url";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice, invoiceParser } from "./invoice.js";

export async function runExample() {
  await using extractor = new Extractor({
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [invoiceParser],
  });
  return await extractor.extract(fileURLToPath(new URL("./invoice.pdf", import.meta.url)), Invoice);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify((await runExample()).data, null, 2));
}
