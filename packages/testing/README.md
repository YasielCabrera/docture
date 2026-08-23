# @docture/testing

The shared test kit. Two jobs.

## 1. Conformance suites

What makes "swap `pdfjs-dist` for `mupdf`" a tested guarantee rather than an interface
coincidence. Every loader and rasterizer package runs the same suite against its own class:

```ts
import { describeLoaderConformance } from "@docture/testing";
import { DocumentLoaderMuPdf } from "../src/index.js";

describeLoaderConformance({ name: "DocumentLoaderMuPdf", create: () => new DocumentLoaderMuPdf() });
```

It checks honest self-description, page numbering and dimensions, text/page consistency, the
digital-vs-scanned verdict, multi-page documents, geometry inside the page box and sorted in
reading order, on-demand rendering, an already-aborted signal, non-document bytes, and
double disposal. Checks a library genuinely cannot satisfy are skipped from its declared
`capabilities`, or explicitly via `skip`.

## 2. Synthetic fixtures

```ts
const pdf = await makeInvoicePdf({ seed: 11, lineItemCount: 45 });
pdf.bytes;      // a real PDF with a real text layer
pdf.expected;   // the ground truth that produced it
```

Generated rather than committed, because extraction is usually tested against documents that
are confidential, which makes a corpus impossible to ship and impossible to review. A
generated document is public, diffable, and its expected output *cannot* drift from the bytes,
since the same values wrote both. `seed` fully determines the result, so a failure is
reproducible on every machine.

`textless: true` produces a page of vector marks only, the stand-in for a scan.

`makeRichDocumentPdf()` produces a two-page conversion fixture with columns, typography,
a list, table, link, code, and embedded raster image.

## Also

`inMemoryLoader`, `loadedDocument`, `fixedStrategy`, `failingStrategy` are doubles for testing
code that *consumes* docture without touching a PDF library or a model.
