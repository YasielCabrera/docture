---
"docture": patch
---

`Attempt.errorCode` and OCR fallback warnings are typed as `DoctureErrorCode`, and `safeConvert()` types its failure as `DoctureError | Error`, like `safeExtract()`.
