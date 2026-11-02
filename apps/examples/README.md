# Docture examples

Each folder demonstrates one part of Docture using files you can open and inspect.
Start with [quick-start](quick-start), then choose the feature you need. The folders
have names rather than lesson numbers, so you can read them independently.

Use Node.js 22 or later. From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter @docture/examples quick-start
```

The quick start extracts `INV-2026-0142` and a total of `717.3` from the
[invoice beside the code](quick-start/invoice.pdf). Its parser targets that layout.
Use [with-a-model](with-a-model) for invoices whose layout you do not control.

The PDF inputs are included in their example folders. You do not need to download a
shared corpus. [Document sources](SOURCES.md) records their origins. DOCX, email,
CSV, and Docling examples include native files because those formats are the subject
of the example. The testing and synthetic examples also save generated PDFs for
inspection.

## Use a copied folder

Copy the complete example folder, including its PDFs, native inputs, and sibling
source files. Use Node.js 22 or later, set `"type": "module"` in your application's
`package.json`, and run TypeScript with `tsx`:

```sh
pnpm add -D tsx
pnpm exec tsx index.ts
```

These examples target the packages built from this checkout. The npm release of
`docture@0.2.0` currently uses the earlier package layout and does not export
`docture/node`. Installing that release cannot run these examples unchanged.
The current `@docture/eval` and `@docture/synthetic` builds also need matching local
tarballs until their matching releases are available. The installation recipes below
name the integrations to install; they assume those matching package builds.

To create a local library tarball, run this from the repository root after building:

```sh
pnpm --filter docture pack --pack-destination /tmp/docture-packed
```

In a copied quick-start folder, install that tarball and its selected engines:

```sh
pnpm add /tmp/docture-packed/docture-0.2.0.tgz zod pdfjs-dist
pnpm add -D tsx
pnpm exec tsx index.ts
```

Examples importing the CLI, evaluation, or synthetic packages need those packages
packed from the same checkout as well. Their dependencies must resolve to the same
matching tarballs, rather than older npm releases. The workspace commands remain the
complete setup for those examples.

## Choose an example

Run the command in the middle column with `pnpm --filter @docture/examples`.
Each folder's README includes its expected result and any additional setup.

| Example | Command | Operation | Setup |
| --- | --- | --- | --- |
| [quick-start](quick-start) | `quick-start` | Extract a small invoice schema using a fixed-layout parser. | None |
| [contracts-and-schemas](contracts-and-schemas) | `contracts` | Define a contract, infer its type, and represent an absent field with null. | None |
| [loaders-and-sources](loaders-and-sources) | `loaders` | Read a PDF from a path or bytes using PDF.js and MuPDF. | None |
| [capabilities-and-composition](capabilities-and-composition) | `capabilities` | Add a rasterizer and save a page preview. | None |
| [your-own-plugins](your-own-plugins) | `plugins`, `custom-loader` | Extract line items with a custom strategy or load a local CSV. | None |
| [fallback-routing-and-errors](fallback-routing-and-errors) | `fallback` | Route two invoice layouts and handle an unsupported document. | None |
| [with-a-model](with-a-model) | `model` | Extract an invoice with an AI SDK model. | API key |
| [long-documents](long-documents) | `long`, `paginated` | Chunk a statement and merge partial results, or use paginated model extraction. | API key for `paginated` |
| [scanned-and-ocr](scanned-and-ocr) | `scanned` | OCR an image-only bank statement. | OCR model download |
| [classification](classification) | `classify` | Classify an invoice and a bank statement. | None |
| [bundles-and-splitting](bundles-and-splitting) | `bundles` | Split a statement into account sections and extract each one. | None |
| [accuracy-and-batch](accuracy-and-batch) | `accuracy` | Extract two invoices concurrently and score them against local truth. | None |
| [under-the-hood](under-the-hood) | `internals` | Load a PDF once and pass the loaded source to extraction. | None |
| [testing-your-pipeline](testing-your-pipeline) | `testing` | Test real PDF extraction and save a generated fixture. | None |
| [cli](cli) | `cli` | Run the installed CLI with a local config and invoice. | None |
| [document-conversion](document-conversion) | `convert` | Convert a statement to Markdown and retrieval chunks. | None |
| [docling](docling) | `docling`, `docling-service` | Import native Docling JSON or convert a PDF through Docling Serve. | Docling service for `docling-service` |
| [checked-tools-eval](checked-tools-eval) | `checked-tools-eval`, `model-tool` | Use checked construction and expose extraction as a model tool. | API key for `model-tool` |
| [input-loaders](input-loaders) | `input-loaders`, `azure`, `ocr-fallback` | Read DOCX and email, call Azure Read, or OCR scanned pages selectively. | Azure account or OCR models for the variants |
| [paperless](paperless) | `paperless` | Read an original PDF from Paperless and extract its invoice fields. | Paperless instance and token |
| [http-service](http-service) | `service`, `service-client` | Start a warm extraction service and send a local PDF from a client. | Two terminals |
| [evaluate-a-schema](evaluate-a-schema) | `evaluate` | Evaluate invoice extraction against a spec, dataset, and quality gate. | None |
| [synthetic-corpus](synthetic-corpus) | `synthetic`, `synthetic-eval` | Generate digital and scanned invoice cases, then evaluate extraction. | None |

## Verify the examples

```sh
pnpm --filter @docture/examples offline
pnpm --filter @docture/examples test
pnpm --filter @docture/examples typecheck
```

`offline` runs the local examples that terminate without credentials, external
services, or OCR model downloads. It fails if an input is missing or an example
fails. Tests check extracted values, page groups, generated output, error handling,
HTTP requests, and provider behavior. Model and cloud-service tests use deterministic
mocks. Those tests do not establish that a live service is configured correctly.

Run `scanned` and `ocr-fallback` separately to exercise actual OCR. Their first run
downloads English language data. Configure the credentials named in each README
before running a model or cloud-service example. Missing credentials fail with a
setup error.

Generated files go into each example's ignored `output/` folder. The
[benchmarks](benchmarks) use controlled generated inputs for measurement and are
separate from these consumer examples.

## Install integrations in your application

The private examples workspace installs the engines needed by the examples. A
consumer application installs the published packages and only the engines it uses.

| Import | Installation |
| --- | --- |
| `docture` or `docture/node` | `pnpm add docture` |
| `docture/loaders/pdfjs` | `pnpm add docture pdfjs-dist` |
| `docture/loaders/mammoth` | `pnpm add docture mammoth` |
| `docture/inputs/email` | `pnpm add docture postal-mime` |
| `docture/loaders/mupdf` | `pnpm add docture mupdf` |
| `docture/raster/canvas` | `pnpm add docture pdfjs-dist @napi-rs/canvas` |
| `docture/loaders/tesseract` | `pnpm add docture tesseract.js` |
| `docture/llm/text`, `docture/llm/tool` | `pnpm add docture ai zod` |
| `@docture/cli` | `pnpm add @docture/cli` |
| `@docture/eval` | `pnpm add -D @docture/eval` |
| `@docture/synthetic` | `pnpm add -D @docture/synthetic pdfkit pdfjs-dist @napi-rs/canvas sharp` |

Schemas in these examples use Zod. Add `zod` when copying one into your application.
