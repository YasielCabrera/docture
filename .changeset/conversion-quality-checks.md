---
"docture": minor
"@docture/eval": minor
---

Add `checkConversion` to `@docture/eval/conversion`. It grades converted output with presence, absence, order, and table-neighbour checks, each with a stable id and a literal failure reason. Page, provenance, and merged-cell checks read the converted document; text checks also accept Markdown or plain text. `docture/testing/fixtures` adds `conversionCorpus`, loaded documents for known layout cases with the checks each should pass.
