---
"@docture/synthetic": minor
"@docture/eval": minor
"docture": minor
"@docture/cli": minor
---

Publish @docture/synthetic. It generates labeled synthetic documents from an extraction schema, with seeded models, generators, constraints, scenarios, printed masks and typed templates. Each label records the field's value, page and box. Optional entries render with PDFKit or Chromium, verify labels through PDF.js, measure how far a template's text drifts from a reference PDF, add scan, photo and fax degradations with sharp, generate locale-aware values with Faker, build cached text pools with an AI SDK model, and write corpora that @docture/eval reads.

@docture/eval now reads expected field locations from the `locations` field of `jsonlDataset` rows and from a `locations.json` file in each `folderDataset` case. Docture adds the error codes `SYNTHESIS_FAILED`, `TEMPLATE_INVALID` and `LABEL_VERIFICATION_FAILED`.
