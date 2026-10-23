import { createExtractor, defineLoader, defineStrategy, inferForm } from "docture";
import { Invoice } from "./invoice.js";

const csvLoader = defineLoader({
  name: "invoice-csv",
  capabilities: {
    text: true,
    geometry: false,
    images: false,
    mimeTypes: ["text/csv"],
  },
  async load(raw, context) {
    context.signal.throwIfAborted();
    const text = new TextDecoder().decode(raw.bytes);
    return {
      pages: [{ pageNumber: 1, width: 0, height: 0, text }],
      text,
      form: inferForm([text.trim().length]),
      loader: "invoice-csv",
    };
  },
});

const csvInvoice = defineStrategy({
  name: "invoice-csv",
  requires: [],
  async extract({ document }) {
    const [invoiceNumber, issuedAt, total] = document.text.trim().split(",");
    if (invoiceNumber === undefined || issuedAt === undefined || total === undefined) {
      throw new Error("expected invoice number, issue date, and total");
    }
    return {
      data: {
        invoiceNumber,
        issuedAt,
        total: Number(total),
        lineItems: [],
      },
    };
  },
});

const extractor = createExtractor({ loaders: [csvLoader], strategies: [csvInvoice] });
const bytes = new TextEncoder().encode("INV-1,2026-01-15,120.50");
const result = await extractor.extract({ bytes, mimeType: "text/csv" }, Invoice);
console.log(result.data.total);
