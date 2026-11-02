import { defineStrategy } from "docture";
import { z } from "zod";

export const Invoice = z.object({ invoiceNumber: z.string(), total: z.number() });

export const invoiceParser = defineStrategy({
  name: "invoice-parser",
  requires: ["TEXT_LAYER"],
  async extract({ document }) {
    const invoiceNumber = /Invoice no[.:]?\s*(\S+)/iu.exec(document.text)?.[1];
    const total = /(?:^|\n)Total:?\s*[$₹]\s*([\d,.]+)/iu.exec(document.text)?.[1]
      ?? /(?:^|\n)Total due:?\s*[$₹]\s*([\d,.]+)/iu.exec(document.text)?.[1];
    if (invoiceNumber === undefined || total === undefined) throw new Error("Unrecognized invoice layout.");
    return { data: { invoiceNumber, total: Number(total.replaceAll(",", "")) } };
  },
});
