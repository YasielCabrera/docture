# @docture/eval

## Unreleased

### Minor Changes

- 9fc9b6a: Add `checkConversion` to `@docture/eval/conversion`. It grades converted output with presence, absence, order, and table-neighbour checks, each with a stable id and a literal failure reason. Page, provenance, and merged-cell checks read the converted document; text checks also accept Markdown or plain text. `docture/testing/fixtures` adds `conversionCorpus`, loaded documents for known layout cases with the checks each should pass.
- ad9cc23: Publish @docture/eval with schema-driven evaluation, project-defined datasets, versioned results, comparison, gates, reporters, calibration, grounding, framework adapters and an optional LLM judge. Replace docture/eval with the new package, move conversion checks to @docture/eval/conversion, and add the docture eval subcommands and stable eval error identities.
- 5536666: Publish @docture/synthetic. It generates labeled synthetic documents from an extraction schema, with seeded models, generators, constraints, scenarios, printed masks and typed templates. Each label records the field's value, page and box. Optional entries render with PDFKit or Chromium, verify labels through PDF.js, measure how far a template's text drifts from a reference PDF, add scan, photo and fax degradations with sharp, generate locale-aware values with Faker, build cached text pools with an AI SDK model, and write corpora that @docture/eval reads.

  @docture/eval now reads expected field locations from the `locations` field of `jsonlDataset` rows and from a `locations.json` file in each `folderDataset` case. Docture adds the error codes `SYNTHESIS_FAILED`, `TEMPLATE_INVALID` and `LABEL_VERIFICATION_FAILED`.

### Patch Changes

- 49d0324: Ship the complete offline Markdown documentation once in `docture`, generated on build and pack. Expose `docture/docs/manifest.json` for discovery with exact documented package versions and content hashes. Point each package's agent guide to the installed snapshot and reject unreleased documentation during publication.
- 19f9cff: In `@docture/eval`, aggregate precision, recall, F1, and status counts by normalized field path. Show the worst fields in verbose eval output.
- 19f9cff: Export an `@docture/eval` gate for minimum F1 and maximum priced cost. Add --max-cost-usd to docture eval and report all failed threshold reasons in its summary.

  Keep known billed usage and attempt history on exhausted extraction errors, including schema violations. Include paid failures in eval token totals and cost gates.

