import { defineStrategy } from "docture";
import { z } from "zod";

export const Invoice = z.object({ invoiceNumber: z.string(), total: z.number() });

export const invoiceParser = defineStrategy({
  name: "supply-invoice",
  requires: ["TEXT_LAYER"],
  async extract({ document }) {
    const invoiceNumber = /Invoice No:\s*(\S+)/u.exec(document.text)?.[1];
    const total = /(?:^|\n)Total:?\s*\$\s*([\d,.]+)/u.exec(document.text)?.[1]
      ?? /(?:^|\n)Total Due:?\s*\$\s*([\d,.]+)/u.exec(document.text)?.[1];
    if (invoiceNumber === undefined || total === undefined) {
      throw new Error("Expected the bundled supply invoice layout.");
    }
    return { data: { invoiceNumber, total: Number(total.replaceAll(",", "")) } };
  },
});
