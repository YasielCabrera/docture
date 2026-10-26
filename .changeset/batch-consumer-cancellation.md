---
"docture": patch
---

Abort and await in-flight extraction and conversion jobs when a batch consumer exits early. The caller's abort signal remains connected. A job that ignores cancellation delays the generator's return until it settles.

Preserve inherited, getter-based and non-enumerable extraction and conversion options when attaching batch cancellation.
