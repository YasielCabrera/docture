import { DocumentConverter } from "docture/node";
import { checkConversion } from "@docture/eval/conversion";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { makeRichDocumentPdf } from "docture/testing/fixtures";

const pdf = await makeRichDocumentPdf();
const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderPdfJs());

try {
  const result = await converter.convert(pdf.bytes, { format: "json" });
  const report = checkConversion(result, [
    { id: "intro", kind: "present", text: "Grounded text stays exact: <alpha> & beta.", page: 1 },
    { id: "no-invented-text", kind: "absent", text: "Lorem ipsum" },
    { id: "columns", kind: "order", before: "Left column starts here.", after: "Right column starts here." },
    { id: "accuracy", kind: "table", header: ["Metric", "Value"], cell: "Accuracy", right: "100", down: "Pages" },
  ]);

  console.log(`${report.passed}/${report.results.length} conversion checks passed`);
  for (const check of report.results) {
    if (!check.pass) console.log(`${check.id}: ${check.reason}`);
  }
} finally {
  await converter.dispose();
}
