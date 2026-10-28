---
"docture": minor
---

Report conflicting scalar values. When the requests of a multi-request extraction (text `paginate` or `concatenate`, or vision with several page groups) return different present values for the same scalar, the first value still wins and `result.conflicts` lists each disagreeing path with every value and the pages that gave it. A path where one part gave a scalar and another an object or array is a conflict too. The field is omitted when the parts agree, and a repaired answer keeps the conflicts of the extraction it replaced. Strings compare after trimming and numbers by value; array rows are never compared. `ConflictingValue.value` is a scalar, or the object or array that met one. `StrategyOutcome.conflicts` carries the list from a custom strategy. `docture/llm/merge` adds `mergePartialsWithDiagnostics(parts)`; `mergePartials` and its zero/false presence rule are unchanged.
