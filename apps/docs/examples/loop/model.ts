import { defineModel, defineTemplate, gen, locales } from "@docture/synthetic";
import { Invoice } from "./invoice.js";

export const model = defineModel(Invoice, {
  fields: {
    invoiceNumber: gen.pick(["INV-101", "INV-102", "INV-103"]),
    totalCents: gen.int(1000, 9999),
  },
});

export const template = defineTemplate<Invoice>()({
  key: "invoice",
  family: "invoice",
  locale: locales["en-US"],
  page: { size: { width: 612, height: 792 }, margin: 40 },
  printed: { invoiceNumber: true, totalCents: true },
  draw(page, invoice) {
    page.text("SAMPLE INVOICE - Amounts are in cents", { x: 40, y: 40 });
    page.text("Invoice number:", { x: 40, y: 80 });
    page.field("invoiceNumber", invoice.invoiceNumber, { x: 200, y: 80 });
    page.text("Total cents:", { x: 40, y: 110 });
    page.field("totalCents", String(invoice.totalCents), { x: 200, y: 110 });
  },
});

