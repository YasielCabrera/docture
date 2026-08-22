import { contract } from "docture";
import { z } from "zod";

export const Invoice = contract({
  name: "invoice",
  description: "A commercial invoice.",
  schema: z.object({
    invoiceNumber: z.string().describe("The invoice number printed on the document"),
    issuedAt: z.string().describe("Issue date in YYYY-MM-DD format"),
    total: z.number().describe("Grand total including tax"),
    lineItems: z.array(
      z.object({
        description: z.string(),
        quantity: z.number(),
        amount: z.number(),
      }),
    ),
  }),
});
