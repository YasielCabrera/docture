import { defineConfig } from "@docture/cli/config";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice, invoiceParser } from "./invoice.js";

export default defineConfig({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [invoiceParser],
  schema: Invoice,
});
