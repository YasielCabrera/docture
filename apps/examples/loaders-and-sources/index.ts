import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineStrategy, type DocumentLoader } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentLoaderMuPdf } from "docture/loaders/mupdf";
import { z } from "zod";

const Summary = z.object({ pages: z.array(z.number()), total: z.number() });

async function readSources(loader: DocumentLoader) {
  await using extractor = new Extractor({
    loaders: [loader],
    strategies: [defineStrategy({
      name: "invoice-summary",
      requires: ["TEXT_LAYER"],
      async extract({ document }) {
        const total = /Total due\s+₹([\d,.]+)/u.exec(document.text)?.[1];
        if (!total) throw new Error("No invoice total found.");
        return { data: { pages: document.pages.map((page) => page.pageNumber), total: Number(total.replaceAll(",", "")) } };
      },
    })],
  });
  const path = fileURLToPath(new URL("./invoice.pdf", import.meta.url));
  const bytes = new Uint8Array(await readFile(path));
  return {
    fromPath: await extractor.extractData(path, Summary),
    fromBytes: await extractor.extractData({ bytes, mimeType: "application/pdf" }, Summary),
  };
}

export async function runExample() {
  return {
    pdfjs: await readSources(new DocumentLoaderPdfJs()),
    mupdf: await readSources(new DocumentLoaderMuPdf()),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
