import { defineTemplate, drawTable, locales, prints, type ConcretePath } from "../src/index.js";
import type { Invoice } from "./fixtures.js";

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
