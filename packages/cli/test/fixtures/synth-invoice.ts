import { z } from "zod";
import { before, defineModel, defineTemplate, drawTable, gen, locales, prints, scenario, sumOf, validIban, type ConcretePath, type ModelOptions } from "@docture/synthetic";

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


export const classic = defineTemplate<Invoice>()({
  key: "classic",
  aliases: ["default"],
  family: "invoice",
  tags: { columns: 1 },
  locale: locales["de-DE"],
  printed: {
    invoiceNumber: true,
    issuedAt: true,
    dueAt: true,
    currency: false,
    seller: { name: true, iban: true, vatId: true },
    buyer: { name: true, contact: true },
    paymentMethod: prints((method: Invoice["paymentMethod"]) => (method === "card" ? "card" : "bank")),
    lineItems: { items: { description: true, quantity: true, unitPriceCents: false, amountCents: true } },
    subtotalCents: true,
    taxCents: true,
    totalCents: true,
    note: (note) => note.length > 0,
  },
  draw(page, value, f) {
    const right = page.size.width - 50;
    page.text("RECHNUNG", { x: 50, y: 50, size: 20, font: "bold" });
    page.field("seller.name", value.seller.name, { x: 50, y: 80, size: 11 });
    if (value.seller.vatId !== undefined) page.field("seller.vatId", `USt-IdNr. ${value.seller.vatId}`, { x: 50, y: 95, size: 9 });
    page.text("Rechnungsnr.", { x: 380, y: 50, size: 9 });
    page.field("invoiceNumber", value.invoiceNumber, { x: right, y: 50, size: 9, align: "right" });
    page.text("Datum", { x: 380, y: 64, size: 9 });
    page.field("issuedAt", f.date(value.issuedAt), { x: right, y: 64, size: 9, align: "right" });
    page.text("Fällig", { x: 380, y: 78, size: 9 });
    page.field("dueAt", f.date(value.dueAt), { x: right, y: 78, size: 9, align: "right" });
    page.text("An", { x: 50, y: 130, size: 9, font: "bold" });
    page.field("buyer.name", value.buyer.name, { x: 50, y: 144 });
    if (value.buyer.contact !== undefined) page.field("buyer.contact", `z. Hd. ${value.buyer.contact}`, { x: 50, y: 158, size: 9 });
    let y = drawTable(page, {
      path: "lineItems",
      items: value.lineItems,
      x: 50,
      y: 200,
      bottom: page.size.height - 60,
      continueAt: 60,
      reserveAfter: 110,
      style: { size: 9 },
      headerStyle: { font: "bold" },
      columns: [
        { header: "Pos.", width: 35, text: (_, index) => String(index + 1) },
        { header: "Beschreibung", width: 270, key: "description", text: (item) => item.description },
        { header: "Menge", width: 60, key: "quantity", align: "right", text: (item) => f.number(item.quantity) },
        { header: "Betrag", width: 130, key: "amountCents", align: "right", text: (item) => f.money(item.amountCents) },
      ],
    });
    y += 12;
    const total = (label: string, path: ConcretePath<Invoice>, cents: number, bold = false): void => {
      page.text(label, { x: 330, y, size: 10, ...(bold ? { font: "bold" } : {}) });
      page.field(path, f.money(cents), { x: right, y, size: 10, align: "right", ...(bold ? { font: "bold" } : {}) });
      y += 16;
    };
    total("Zwischensumme", "subtotalCents", value.subtotalCents);
    total("USt. 19 %", "taxCents", value.taxCents);
    total("Gesamt", "totalCents", value.totalCents, true);
    page.text("Zahlung", { x: 50, y: y + 10, size: 9, font: "bold" });
    page.field("paymentMethod", value.paymentMethod === "card" ? "Kartenzahlung" : "Überweisung", { x: 110, y: y + 10, size: 9 });
    page.field("seller.iban", `IBAN ${value.seller.iban}`, { x: 50, y: y + 24, size: 9 });
    if (value.note !== null) page.field("note", value.note, { x: 50, y: y + 44, size: 9, width: 300 });
  },
});

export const short = scenario<Invoice>({ name: "short", tags: ["edge"], fields: { lineItems: gen.array({ length: 1 }) } });
