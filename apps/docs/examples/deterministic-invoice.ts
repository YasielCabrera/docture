import { defineStrategy, type TextLine } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice } from "./invoice.js";

function labelledValue(lines: readonly TextLine[], label: string): string {
  const line = lines.find((candidate) => candidate.text.startsWith(label));
  if (line === undefined) throw new Error(`${label} not found`);
  return line.text.slice(label.length).trim();
}

function lineItems(lines: readonly TextLine[]) {
  return lines.flatMap((line) => {
    const match = /^(.* #\d+)\s+(\d+)\s+[\d,]+\.\d{2}\s+([\d,]+\.\d{2})$/.exec(line.text);
    if (match === null) return [];
    const [, description, quantity, amount] = match;
    if (description === undefined || quantity === undefined || amount === undefined) return [];
    return [{
      description,
      quantity: Number(quantity),
      amount: Number(amount.replaceAll(",", "")),
    }];
  });
}

const invoiceParser = defineStrategy({
  name: "invoice-parser",
  requires: ["TEXT_LAYER", "GEOMETRY"],
  async extract({ document }) {
    const lines = document.pages.flatMap((page) => page.lines ?? []);
    return {
      data: {
        invoiceNumber: labelledValue(lines, "Invoice Number:"),
        issuedAt: labelledValue(lines, "Issue Date:"),
        total: Number(labelledValue(lines, "TOTAL (EUR)").replaceAll(",", "")),
        lineItems: lineItems(lines),
      },
    };
  },
});

const extractor = new Extractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [invoiceParser],
});

const result = await extractor.extract("invoice.pdf", Invoice);
console.log(result.data.total, result.method);
