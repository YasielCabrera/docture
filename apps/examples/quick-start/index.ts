import { fileURLToPath } from "node:url";
import { contract, defineStrategy } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

export const Invoice = contract({
  name: "invoice",
  schema: z.object({ invoiceNumber: z.string(), total: z.number().nonnegative() }),
});

export async function runExample() {
  const invoiceParser = defineStrategy({
    name: "supply-invoice",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const invoiceNumber = /Invoice No:\s*(\S+)/u.exec(document.text)?.[1];
      const total = /Total Due\s+\$([\d,.]+)/u.exec(document.text)?.[1];
      if (!invoiceNumber || !total) throw new Error("The supply invoice layout did not match.");
      return { data: { invoiceNumber, total: Number(total.replaceAll(",", "")) } };
    },
  });

  await using extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(invoiceParser);

  const invoice = fileURLToPath(new URL("./invoice.pdf", import.meta.url));
  const result = await extractor.extract(invoice, Invoice);
  return { data: result.data, method: result.method, loader: result.loader };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
