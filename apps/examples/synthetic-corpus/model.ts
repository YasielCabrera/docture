import { constraint, defineModel, defineTemplate, gen, locales } from "@docture/synthetic";
import { z } from "zod";

export const Invoice = z.object({
  invoiceNumber: z.string(),
  customer: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  totalCents: z.number().int(),
});
type Invoice = z.infer<typeof Invoice>;

export const invoiceModel = defineModel(Invoice, {
  fields: {
    invoiceNumber: gen.pattern("INV-#####"),
    customer: gen.pick(["Example Studio", "Example Workshop"]),
    quantity: gen.int(1, 10),
    unitPriceCents: gen.int(100, 2000),
  },
  derive: (invoice) => ({ ...invoice, totalCents: invoice.quantity * invoice.unitPriceCents }),
  constraints: [constraint<Invoice>("total equals quantity times price", (invoice) =>
    invoice.totalCents === invoice.quantity * invoice.unitPriceCents ? undefined : "The invoice total does not reconcile.")],
});

export const invoiceTemplate = defineTemplate<Invoice>()({
  key: "invoice",
  family: "invoice",
  locale: locales["en-US"],
  printed: { invoiceNumber: true, customer: true, quantity: true, unitPriceCents: true, totalCents: true },
  draw(page, invoice, format) {
    page.text("Example Supplies", { x: 50, y: 50, size: 22, font: "bold" });
    page.text("SYNTHETIC SAMPLE", { x: 50, y: 82, size: 9 });
    page.field("invoiceNumber", `Invoice: ${invoice.invoiceNumber}`, { x: 50, y: 125 });
    page.field("customer", `Customer: ${invoice.customer}`, { x: 50, y: 155 });
    page.text("Service", { x: 50, y: 210, font: "bold" });
    page.text("Equipment maintenance", { x: 50, y: 240 });
    page.field("quantity", `Quantity: ${invoice.quantity}`, { x: 50, y: 280 });
    page.field("unitPriceCents", `Unit price: ${format.money(invoice.unitPriceCents)}`, { x: 50, y: 310 });
    page.field("totalCents", `Total: ${format.money(invoice.totalCents)}`, { x: 50, y: 360, size: 16, font: "bold" });
  },
});
