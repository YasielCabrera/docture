import { createExtractor } from "@docture/core";
import { formatFailures, scoreExtraction } from "@docture/eval";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { fixedStrategy, makeInvoicePdf } from "@docture/testing";
import { Invoice } from "./invoice.js";

const fixture = await makeInvoicePdf({ seed: 301, lineItemCount: 12 });
const extractor = createExtractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [fixedStrategy("fixture-result", fixture.expected)],
});
const result = await extractor.extract(fixture.bytes, Invoice);
const score = scoreExtraction(fixture.expected, result.data);

console.log(score.f1);
console.log(formatFailures(score));
