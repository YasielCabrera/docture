# Read Word documents and email attachments

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Convert the adjacent `report.docx`, then expand `invoice.eml` and convert its text body and PDF attachment.

```sh
pnpm --filter @docture/examples input-loaders
```

The output contains the quarterly report and the supply invoice text. The DOCX and EML are persisted native files. `invoice.pdf` is the exact attachment in the email.

## Reread scanned pages with OCR

`mixed.pdf` contains the Larkfield tax invoice's digital page followed by the Impact statement's two scanned pages. `ocr.ts` preserves the digital text and uses Tesseract on the low-text pages.

```sh
pnpm --filter @docture/examples ocr-fallback
```

MuPDF reads and renders the PDF. Tesseract downloads its English model on the first run. The output contains the invoice number and the scanned account number `12345678`. OCR can misread individual characters; inspect the printed text before using extracted amounts.

To reproduce the mixed input, run this command from this folder after installing Poppler:

```sh
pdfunite tax-invoice.pdf scanned-statement.pdf mixed.pdf
```

[Document sources](../SOURCES.md).
