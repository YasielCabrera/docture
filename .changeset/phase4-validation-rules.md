---
"docture": minor
---

Add validation rules. Pass `rules` to `createExtractor()` or to a single extraction to check facts a schema cannot express, such as line amounts adding up to the subtotal. Per-call rules are typed from the contract and replace the extractor's rules; an empty array clears them. Rules report by default: `result.validation` now carries `valid: false` and the rule issues instead of a constant `{ valid: true, issues: [] }`. `onRuleFailure: "fail"` fails the attempt with `CONTRACT_VIOLATION` and tries the next strategy. A rule that throws rejects the extraction. `RunOptions` and `BatchOptions` gain a type parameter for the contract data, defaulting to `unknown`.
