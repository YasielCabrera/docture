import { fileURLToPath } from "node:url";
import { contract, defineStrategy, type InferContract } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

export const Invoice = contract({
  name: "invoice",
  description: "A supply invoice with payment terms.",
  hints: "Return null when the document does not print a customer tax identifier.",
  schema: z.object({
    invoiceNumber: z.string(),
    total: z.number().nonnegative(),
    customerTaxIdentifier: z.string().nullable(),
  }),
});
export type InvoiceData = InferContract<typeof Invoice>;

export async function runExample() {
  const parser = defineStrategy({
    name: "supply-invoice",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const invoiceNumber = /Invoice No:\s*(\S+)/u.exec(document.text)?.[1];
      const total = /Total Due\s+\$([\d,.]+)/u.exec(document.text)?.[1];
      if (!invoiceNumber || !total) throw new Error("The supply invoice layout did not match.");
      const customerTaxIdentifier = /Customer Tax ID:\s*(\S+)/u.exec(document.text)?.[1] ?? null;
      return { data: { invoiceNumber, total: Number(total.replaceAll(",", "")), customerTaxIdentifier } };
    },
  });
  await using extractor = new Extractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [parser] });
  return await extractor.extractData(fileURLToPath(new URL("./invoice.pdf", import.meta.url)), Invoice);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
