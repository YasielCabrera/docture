import { fileURLToPath } from "node:url";
import { defineClassification, defineClassifier } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

export const KINDS = [
  defineClassification({
    name: "invoice", description: "A supplier invoice.",
    schema: z.object({ invoiceNumber: z.string(), total: z.number() }),
  }),
  defineClassification({
    name: "bank-statement", description: "A bank account statement.",
    schema: z.object({ accountNumber: z.string() }),
  }),
] as const;

export function headingClassifier() {
  return defineClassifier({
    name: "document-heading",
    requires: ["TEXT_LAYER"],
    async classify({ document, candidates }) {
      const name = /TRUE CHECKING/u.test(document.text) ? "bank-statement"
        : /\bINVOICE\b/u.test(document.text) ? "invoice" : null;
      if (!candidates.some((candidate) => candidate.name === name)) return null;
      return { classifier: "document-heading", name, confidence: 1 };
    },
  });
}

export async function runExample() {
  await using extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadClassifier(headingClassifier());
  const classifications = [];
  for (const file of ["invoice.pdf", "statement.pdf"]) {
    const result = await extractor.classify(fileURLToPath(new URL(file, import.meta.url)), KINDS);
    classifications.push({ file, name: result.name, confidence: result.confidence });
  }
  return classifications;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
