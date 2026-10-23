import { DocumentLoaderData, Extractor, defineStrategy } from "docture";
import { Invoice } from "./invoice.js";

const parseCsv = defineStrategy({
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
const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderData())
  .loadStrategy(parseCsv);
const bytes = new TextEncoder().encode("INV-1,2026-01-15,120.50");

const result = await extractor.extract(
  { bytes, mimeType: "text/csv", fileName: "invoice.csv" },
  Invoice,
);
console.log(result.data.invoiceNumber);
