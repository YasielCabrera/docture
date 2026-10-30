import { z } from "zod";

export const Invoice = z.object({
  invoiceNumber: z.string().describe("The invoice number printed on the document"),
  issuedAt: z.string().describe("Issue date in YYYY-MM-DD format"),
  total: z.number().describe("Grand total including tax"),
});
