import { createExtractor } from "docture/node";
import { looseEval } from "@docture/eval";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { fixedStrategy } from "docture/testing/doubles";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { Invoice, InvoiceSchema } from "./invoice.js";

const fixture = await makeInvoicePdf({ seed: 301, lineItemCount: 12 });
const expected = InvoiceSchema.parse(fixture.expected);
const extractor = createExtractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [fixedStrategy("fixture-result", expected)],
});

try {
  const result = await extractor.extract(fixture.bytes, Invoice);
  const score = looseEval().score(expected, result.data);

  console.log(score.metrics.f1);
  console.log(score.fields.filter(field => field.status !== "match"));
} finally {
  await extractor.dispose();
}
