import { fileURLToPath } from "node:url";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { PaperlessSource } from "docture/sources/paperless";
import { Invoice, invoiceParser } from "./invoice.js";

export async function runExample() {
  const baseUrl = process.env["PAPERLESS_URL"];
  const token = process.env["PAPERLESS_TOKEN"];
  const documentId = Number(process.env["PAPERLESS_DOCUMENT_ID"]);
  if (!baseUrl || !token || !Number.isSafeInteger(documentId) || documentId < 1) {
    throw new Error("Set PAPERLESS_URL, PAPERLESS_TOKEN and PAPERLESS_DOCUMENT_ID after importing invoice.pdf into Paperless.");
  }
  const paperless = new PaperlessSource({ baseUrl, token, apiVersion: 10 });
  const document = await paperless.read(documentId, { mode: "original" });
  await using extractor = new Extractor({
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [invoiceParser],
  });
  const result = await extractor.extract(document.source, Invoice);
  return { data: result.data, provenance: document.provenance };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runExample(), null, 2));
