# @docture/synthetic

## Unreleased

### Patch Changes

- Link the package homepage to the hosted synthetic data documentation.

## 0.3.0

### Minor Changes

- 4c9f2bb: Compose IBAN strings from caller-generated country and BBAN fields. Reuse field generators while the consuming schema owns its record shape and national formatting. Generate schema-validated structured pools for any JSON data model from seeded or model-backed sources. Structured pools validate cached raw inputs, preserve schema transformations, and support explicit offline reads.

  Declare captured data, helper revisions, and asset bytes as model or corpus dependencies. Their hashes affect corpus freshness and appear beside observed peer versions in corpus evidence. The synthetic CLI forwards configured corpus dependencies.

- 5536666: Publish @docture/synthetic. It generates labeled synthetic documents from an extraction schema, with seeded models, generators, constraints, scenarios, printed masks and typed templates. Each label records the field's value, page and box. Optional entries render with PDFKit or Chromium, verify labels through PDF.js, measure how far a template's text drifts from a reference PDF, add scan, photo and fax degradations with sharp, generate locale-aware values with Faker, build cached text pools with an AI SDK model, and write corpora that @docture/eval reads.

  @docture/eval now reads expected field locations from the `locations` field of `jsonlDataset` rows and from a `locations.json` file in each `folderDataset` case. Docture adds the error codes `SYNTHESIS_FAILED`, `TEMPLATE_INVALID` and `LABEL_VERIFICATION_FAILED`.

- f898761: Add React templates to @docture/synthetic. The new `@docture/synthetic/react-pdf` entry defines templates as React components rendered with `@react-pdf/renderer`: `defineReactTemplate` takes a `render` function that returns pages, and each printed value sits in a `<Field path>` whose label box comes from react-pdf's layout. Fields typed from the model, automatic page wrapping, repeating headers, custom fonts and async asset preparation are supported, and missing glyphs, mask mismatches and unboxable fields fail with `TemplateError`. `react` (>=18.3.1 <20.0.0) and `@react-pdf/renderer` (4.9.0) are optional peers.

  The root exports `RenderingTemplate` and `SynthTemplate`, and `@docture/synthetic/pdfkit` exports `renderTemplate`, so `writeCorpus`, `defineSynthConfig` and `docture synth` accept React templates beside PDFKit templates. `docture synth` explains how to load `.tsx` templates when Node cannot import them.

  `verifyLabels` now accepts letter-spaced text, which PDF.js reads back with spaces between glyphs, by comparing the spans centred in a label's box without whitespace.

### Patch Changes

- 49d0324: Ship the complete offline Markdown documentation once in `docture`, generated on build and pack. Expose `docture/docs/manifest.json` for discovery with exact documented package versions and content hashes. Point each package's agent guide to the installed snapshot and reject unreleased documentation during publication.
