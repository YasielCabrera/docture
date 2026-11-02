import { fileURLToPath } from "node:url";
import { defineStrategy } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { MuPdfRasterizer } from "docture/loaders/mupdf";
import { z } from "zod";

export async function runExample() {
  const ocr = new DocumentLoaderTesseract({
    rasterizer: new MuPdfRasterizer(),
    languages: ["eng"],
    concurrency: 1,
  });
  const statementParser = defineStrategy({
    name: "statement-account",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const accountNumber = /Statement of Account\s+(\d+)/iu.exec(document.text)?.[1];
      if (!accountNumber) throw new Error("OCR did not recover the statement account number.");
      return { data: { accountNumber, pagesRead: document.pages.length } };
    },
  });
  await using extractor = new Extractor({ loaders: [ocr], strategies: [statementParser] });
  return await extractor.extractData(fileURLToPath(new URL("./scanned-statement.pdf", import.meta.url)), z.object({
    accountNumber: z.string(), pagesRead: z.number(),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
