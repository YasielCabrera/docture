---
"docture": patch
---

Reject an `onRuleFailure` other than `"report"` or `"fail"` when the extractor is created or before a call runs any strategy, and reject a validation rule that returns something other than an array of `{ path, message }` issues with a `TypeError` that names the rule.
