import { z } from "zod";
import { before, defineModel, gen, sumOf, validIban, type ModelOptions } from "../src/index.js";

export const Invoice = z.object({
  invoiceNumber: z.string(),
  issuedAt: z.string(),
  dueAt: z.string(),
  currency: z.enum(["EUR", "USD"]),
  seller: z.object({ name: z.string(), iban: z.string(), vatId: z.string().optional() }),
  buyer: z.object({ name: z.string(), contact: z.string().optional() }),
  paymentMethod: z.enum(["card", "transfer", "direct-debit"]),
  lineItems: z.array(z.object({ description: z.string(), quantity: z.number().int().min(1), unitPriceCents: z.number().int(), amountCents: z.number().int() })),
  subtotalCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
  note: z.string().nullable(),
});
export type Invoice = z.infer<typeof Invoice>;

export const SELLERS = ["Nordwind Logistik GmbH", "Atlas Office Supply", "Kestrel Labs", "Bäckerei Öztürk"];

export const invoiceFields: ModelOptions<Invoice>["fields"] = {
  invoiceNumber: gen.pattern("INV-######"),
  issuedAt: gen.date({ from: "2024-01-01", to: "2025-12-31" }),
  dueAt: gen.dateAfter("issuedAt", { days: [14, 45] }),
  "seller.name": gen.pick(SELLERS),
  "seller.iban": gen.iban("DE"),
  "seller.vatId": gen.pattern("DE#########"),
  "buyer.name": gen.pick(["Pine & Co", "Helios Media", "Carla Jiménez"]),
  "buyer.contact": gen.pick(["J. Weber", "M. Ito"]),
  lineItems: gen.array({ length: [1, 6] }),
  "lineItems[].description": gen.words(2, 4),
  "lineItems[].quantity": gen.int(1, 9),
  "lineItems[].unitPriceCents": gen.int(250, 90_000),
  note: gen.pick([null, "Thank you for your business."]),
};

export function withTotals(value: Invoice): Invoice {
  const lineItems = value.lineItems.map((item) => ({ ...item, amountCents: item.quantity * item.unitPriceCents }));
  const subtotalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
  const taxCents = Math.round(subtotalCents * 0.19);
  return { ...value, lineItems, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export const invoiceModel = defineModel(Invoice, {
  fields: invoiceFields,
  derive: withTotals,
  constraints: [sumOf("lineItems[].amountCents", "subtotalCents"), before("issuedAt", "dueAt"), validIban("seller.iban")],
});
