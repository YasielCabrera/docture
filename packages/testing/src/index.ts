/**
 * @docture/testing — the shared test kit.
 *
 * Two jobs:
 *
 *  1. **Conformance suites.** Every loader and rasterizer package runs the same
 *     suite against its own class, which is what makes swapping libraries a tested
 *     guarantee rather than an interface coincidence.
 *  2. **Synthetic fixtures.** Real PDFs with real text layers, generated
 *     deterministically together with their ground truth — so a corpus needs no
 *     confidential documents and expected output cannot drift from the bytes.
 */

export { describeLoaderConformance } from "./conformance/loader.js";
export type { LoaderConformanceOptions } from "./conformance/loader.js";

export { describeRasterizerConformance } from "./conformance/rasterizer.js";
export type { RasterizerConformanceOptions } from "./conformance/rasterizer.js";

export { buildInvoiceData, formatMoney, makeInvoicePdf } from "./fixtures/invoice.js";
export type {
  InvoiceOptions,
  SyntheticDocument,
  SyntheticInvoice,
  SyntheticLineItem,
} from "./fixtures/invoice.js";
export { makeRichDocumentPdf, richDocumentExpected } from "./fixtures/rich-document.js";
export type { RichDocumentExpected } from "./fixtures/rich-document.js";

export { failingStrategy, fixedStrategy, inMemoryLoader, loadedDocument } from "./doubles.js";
