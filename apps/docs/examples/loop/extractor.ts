import { defineStrategy } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Extractor } from "docture/node";

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
        invoiceNumber: after("Invoice number:"),
        totalCents: Number(after("Total cents:")),
      },
    };
  },
});

export const extractor = new Extractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [readLabels],
});
