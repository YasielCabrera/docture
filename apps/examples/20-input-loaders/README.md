# Optional input loaders

Run from the repository root after installing workspace dependencies and building the library.

```sh
pnpm --dir apps/examples exec tsx 20-input-loaders/index.ts
pnpm --dir apps/examples exec tsx 20-input-loaders/azure.ts
pnpm --dir apps/examples exec tsx 20-input-loaders/ocr.ts
```

The first example converts a real DOCX fixture and expands an email containing an HTML body and a generated PDF attachment. A consumer installs `mammoth@1.13.0`, `postal-mime@4.1.4` and a supported `pdfjs-dist` version alongside `docture`.

The Azure example uses a local mock server and needs no credential. The OCR composition example uses deterministic loader objects. To recognize real scans, replace its OCR object with an explicitly installed Tesseract or PaddleOCR loader and keep the caller's quality assessment and intentional-blank policy.
