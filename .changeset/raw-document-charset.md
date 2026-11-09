---
"docture": patch
---

`RawDocument` has an optional `charset`, which `resolveSource()` keeps when a caller sets it, and loaders match media types without case, so a custom type routes to its loader whatever its spelling. Resolved media types are now lower case.
