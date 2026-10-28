---
"docture": minor
"@docture/cli": patch
---

Describe a fail-mode validation rule failure as a rule failure rather than a schema failure. `ContractViolationError` gains `failedCheck` (`"schema"` or `"rule"`), its message names the failed check, and the CLI gives a rule failure its own recovery hint.
