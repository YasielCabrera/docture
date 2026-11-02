# Example documents

The examples include local copies of four approved public documents. Each example
reads the files in its own folder. No download command or shared document registry
is needed to run it.

| Document | Publisher and source | Use |
| --- | --- | --- |
| Larkspur supply invoice | [Original PDF](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf), [publisher's CC0 statement](https://apify.com/egra_van/pdf-invoice-table-extractor) | Default invoice. Five item rows, USD amounts, and 8% sales tax. |
| Larkfield tax invoice | [Original PDF](https://filedone.ai/sample-files/sample-invoice.pdf), [publisher's CC0 terms](https://filedone.ai/sample-files/sample-invoice-pdf) | Second layout. Six item rows, INR amounts, and 18% GST. |
| Carson Bank statement | [Carson Bank specimen](https://www.carsonbank.com/wp-content/uploads/2021/01/Sample-Statement.pdf) | Six pages containing checking, credit-line, and reconciliation sections. |
| Impact Bank statement | [Impact Bank specimen](https://www.impact-bank.com/user/file/dummy_statement.pdf) | Two scanned pages with no text layer, for OCR. |

Both invoice publishers mark their fictional samples as CC0. Their pages allow
reuse without an attribution requirement. The examples copy only the PDF documents,
not the publishers' extraction code. The source URLs remain here for provenance.
The bank statements are specimens published by the banks.

The four source documents retain their original content and publisher markings.
`input-loaders/mixed.pdf` combines the Larkfield tax invoice and both pages of the
Impact statement to demonstrate selective OCR. Its creation command is recorded in
[input-loaders/README.md](input-loaders/README.md). The persisted
`input-loaders/invoice.eml` embeds the exact Larkspur PDF beside it.

[sources.json](sources.json) records source URLs, invoice reuse terms, and SHA-256
checksums for provenance. It is verification metadata. Runnable examples do not
import it. The document tests verify that copies match these checksums and have the
expected pages and text layers.

Format-specific examples also contain native DOCX, EML, CSV, or Docling JSON files.
Examples of the fixture and synthetic APIs generate PDFs because generation is the
operation they demonstrate. Their READMEs describe the generated files.
