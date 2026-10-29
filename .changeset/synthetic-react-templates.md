---
"@docture/synthetic": minor
"@docture/cli": minor
---

Add React templates to @docture/synthetic. The new `@docture/synthetic/react-pdf` entry defines templates as React components rendered with `@react-pdf/renderer`: `defineReactTemplate` takes a `render` function that returns pages, and each printed value sits in a `<Field path>` whose label box comes from react-pdf's layout. Fields typed from the model, automatic page wrapping, repeating headers, custom fonts and async asset preparation are supported, and missing glyphs, mask mismatches and unboxable fields fail with `TemplateError`. `react` (>=18.3.1 <20.0.0) and `@react-pdf/renderer` (4.9.0) are optional peers.

The root exports `RenderingTemplate` and `SynthTemplate`, and `@docture/synthetic/pdfkit` exports `renderTemplate`, so `writeCorpus`, `defineSynthConfig` and `docture synth` accept React templates beside PDFKit templates. `docture synth` explains how to load `.tsx` templates when Node cannot import them.

`verifyLabels` now accepts letter-spaced text, which PDF.js reads back with spaces between glyphs, by comparing the spans centred in a label's box without whitespace.
