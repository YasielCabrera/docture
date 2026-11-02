import { fileURLToPath } from "node:url";
import { defineStrategy } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

export const Invoice = z.object({
  lineItems: z.array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number(), amount: z.number() })).min(1),
  total: z.number(),
});

export function supplyParser() {
  return defineStrategy({
    name: "supply-table",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const rows = document.pages.flatMap((page) => page.lines ?? []);
      const lineItems = rows.flatMap(({ text }) => {
        const match = /^\d+\s+(.+?)\s+[A-Z][A-Z0-9-]*\s+(\d+)\s+\$([\d,.]+)\s+\$([\d,.]+)$/u.exec(text.trim());
        return match ? [{
          description: match[1], quantity: Number(match[2]),
          unitPrice: Number(match[3]?.replaceAll(",", "")), amount: Number(match[4]?.replaceAll(",", "")),
        }] : [];
      });
      const total = /Total Due\s+\$([\d,.]+)/u.exec(document.text)?.[1];
      if (!total) throw new Error("The supply invoice layout did not match.");
      return { data: { lineItems, total: Number(total.replaceAll(",", "")) } };
    },
  });
}

export async function runExample() {
  await using extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(supplyParser());
  return await extractor.extractData(fileURLToPath(new URL("./invoice.pdf", import.meta.url)), Invoice);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
