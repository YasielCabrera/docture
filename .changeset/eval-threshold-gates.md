---
"@docture/eval": patch
"@docture/cli": patch
---

Export an `@docture/eval` gate for minimum F1 and maximum priced cost. Add --max-cost-usd to docture eval and report all failed threshold reasons in its summary.

Keep known billed usage and attempt history on exhausted extraction errors, including schema violations. Include paid failures in eval token totals and cost gates.
