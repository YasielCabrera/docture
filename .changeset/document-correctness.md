---
"docture": patch
---

Derive extraction features from selected pages. Empty or missing-page selections raise `PageSelectionError` with `PAGE_OUT_OF_RANGE`, missing page numbers, and the document page count. Preserve text-only conversion paragraphs and stop unmarked list items from absorbing following content.

Selected pages use the existing 50-character `TEXT_LAYER` threshold. Short digital selections may need another eligible strategy, including when extracted as a `Process` group.

Score matching empty containers as equal. Require matching digit sequences before fuzzy string comparison. Compare validated ISO and English month-name dates by their written calendar day without time-zone conversion.
