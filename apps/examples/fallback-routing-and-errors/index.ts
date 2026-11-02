import { fileURLToPath } from "node:url";
import { defineStrategy } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

export const Invoice = z.object({ invoiceNumber: z.string(), total: z.number() });

export function createExtractor() {
  const supply = defineStrategy({
    name: "supply-invoice",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const invoiceNumber = /Invoice No:\s*(\S+)/u.exec(document.text)?.[1];
      const total = /Total Due\s+\$([\d,.]+)/u.exec(document.text)?.[1];
      if (!document.text.includes("Larkspur Sample Supply Co.") || !invoiceNumber || !total) {
        throw new Error("Not the supply layout.");
      }
      return { data: { invoiceNumber, total: Number(total.replaceAll(",", "")) } };
    },
  });
  const tax = defineStrategy({
    name: "tax-invoice",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const invoiceNumber = /Invoice no\.\s*(\S+)/u.exec(document.text)?.[1];
      const total = /Total due\s+₹([\d,.]+)/u.exec(document.text)?.[1];
      if (!document.text.includes("Larkfield Stationers") || !invoiceNumber || !total) {
        throw new Error("Not the tax layout.");
      }
      return { data: { invoiceNumber, total: Number(total.replaceAll(",", "")) } };
    },
  });
  return new Extractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [supply, tax] });
}

export async function runExample() {
  await using extractor = createExtractor();
  const results = [];
  for (const file of ["invoice.pdf", "tax-invoice.pdf"]) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const result = await extractor.extract(path, Invoice);
    results.push({ file, data: result.data, method: result.method, attempts: result.attempts });
  }
  const unsupported = await extractor.safeExtract(
    fileURLToPath(new URL("./statement.pdf", import.meta.url)), Invoice,
  );
  return { results, unsupported: unsupported.ok ? "extracted" : unsupported.error.message };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
