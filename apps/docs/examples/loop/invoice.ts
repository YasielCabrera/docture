import { z } from "zod";

export const Invoice = z.object({
  invoiceNumber: z.string(),
  totalCents: z.number().int(),
});
export type Invoice = z.infer<typeof Invoice>;
