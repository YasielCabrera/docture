import { expect, it } from "vitest";
import { DocumentLoaderData } from "docture";
import { Extractor } from "docture/node";
import { Invoice, invoiceParser } from "./invoice.js";
import { runExample } from "./index.js";

it("extracts the invoice number and amount printed in the local PDF", async () => {
  const result = await runExample();
  expect(result.data).toEqual({ invoiceNumber: "INV-2026-0142", total: 717.3 });
  expect(result.loader).toBe("pdfjs");
  expect(result.usage.totalTokens).toBe(0);
});

it("uses the printed total when a paid invoice has zero amount due", async () => {
  await using extractor = new Extractor({ loaders: [new DocumentLoaderData()], strategies: [invoiceParser] });
  const result = await extractor.extract({
    bytes: new TextEncoder().encode("INVOICE\nInvoice No: PAID-2026\nTotal Due: $0.00\nTotal: $717.30"),
    mimeType: "text/plain",
  }, Invoice);
  expect(result.data).toEqual({ invoiceNumber: "PAID-2026", total: 717.3 });
});
