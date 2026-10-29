import { createElement as h } from "react";
import { Page, View } from "@react-pdf/renderer";
import { locales } from "@docture/synthetic";
import { defineReactTemplate } from "@docture/synthetic/react-pdf";
import type { Invoice } from "./synth-invoice.js";

/** A React template written with createElement, so Node imports it without a JSX loader. */
export const reactInvoice = defineReactTemplate<Invoice>()({
  key: "react-summary",
  family: "invoice",
  locale: locales["de-DE"],
  printed: {
    invoiceNumber: true,
    issuedAt: false,
    dueAt: false,
    currency: false,
    seller: { name: true, iban: false, vatId: false },
    buyer: false,
    paymentMethod: false,
    lineItems: false,
    subtotalCents: false,
    taxCents: false,
    totalCents: true,
    note: false,
  },
  render: ({ value, format, Field }) =>
    h(
      Page,
      { size: "A4", style: { padding: 50, fontSize: 11 } },
      h(Field, { path: "seller.name", style: { fontSize: 16 } }, value.seller.name),
      h(View, { style: { flexDirection: "row", justifyContent: "space-between", marginTop: 20 } }, h(Field, { path: "invoiceNumber" }, value.invoiceNumber), h(Field, { path: "totalCents" }, format.money(value.totalCents))),
    ),
});
