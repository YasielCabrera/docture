---
"docture": minor
"@docture/cli": patch
---

Invalid options now raise `InvalidOptionError` with code `INVALID_OPTION` instead of `RangeError` or `TypeError`. It carries `option`, `expected` and `received`, and its hint names the accepted values. This covers `concurrency`, `maxRepairs`, `onRuleFailure`, `pagesPerRequest`, `maxEagerPages`, `maxPixels`, chunk budgets, OCR fallback thresholds, `pageWindows` sizes, email limits and empty Tesseract `languages`, which is now rejected when the loader is built. The CLI exits with code 2 for it.
