import { z } from "zod";
import { defineEval, hungarian, identifier, number, sumOf, text, type EvalRules } from "../../src/index.js";

export const Invoice = z.object({
  issuer: z.string(),
  reference: z.string().meta({ "x-docture-eval": "identifier" }),
  issueDate: z.iso.date(),
  status: z.enum(["paid", "due"]),
  totals: z.object({ net: z.number(), tax: z.number(), total: z.number() }),
  lineItems: z.array(z.object({ sku: z.string(), description: z.string(), amount: z.number() })),
});

export type InvoiceView = z.infer<typeof Invoice>;

export const invoiceRules = {
  strings: text({ minSimilarity: 0.9 }),
  segments: { header: ["issuer", "reference", "issueDate", "status"], totals: "totals.**", lineItems: "lineItems[]" },
  fields: {
    "totals.*": number({ abs: 0.01 }),
    "lineItems[].sku": { compare: identifier(), critical: true },
    "lineItems[].description": text({ minSimilarity: 0.8 }),
  },
  arrays: { lineItems: hungarian({ key: ["sku"] }) },
  assertions: [sumOf("lineItems[].amount").equals("totals.net", { abs: 0.01 })],
} satisfies EvalRules;

export const invoiceSpec = defineEval(Invoice, invoiceRules);

export function invoice(overrides: Partial<InvoiceView> = {}): InvoiceView {
  return {
    issuer: "Northwind Industrial GmbH",
    reference: "INV-2024-0042",
    issueDate: "2024-03-05",
    status: "due",
    totals: { net: 30, tax: 5.7, total: 35.7 },
    lineItems: [
      { sku: "A-100", description: "Steel bolts", amount: 10 },
      { sku: "B-200", description: "Washers", amount: 20 },
    ],
    ...overrides,
  };
}
