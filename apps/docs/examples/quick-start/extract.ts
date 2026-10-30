import { defineStrategy } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Extractor } from "docture/node";
import { Invoice } from "./invoice.js";

const readLabels = defineStrategy({
  name: "read-labels",
  requires: ["TEXT_LAYER"],
  async extract({ document }) {
    const text = document.pages.map((page) => page.text).join("\n");
    const after = (label: string) => {
      const value = new RegExp(`${label}\\s*(\\S+)`).exec(text)?.[1];
      if (value === undefined) throw new Error(`${label} not found`);
      return value;
    };
    return {
      data: {
        invoiceNumber: after("Invoice Number:"),
        issuedAt: after("Issue Date:"),
        total: Number(after("TOTAL \\(EUR\\)").replaceAll(",", "")),
      },
    };
  },
});

const extractor = new Extractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [readLabels],
});

const result = await extractor.extract("invoice.pdf", Invoice);
console.log(result.data);
console.log(`${result.method} used ${result.usage.totalTokens} model tokens`);
