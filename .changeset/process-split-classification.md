---
"docture": patch
---

`Process` extracts each group under the classification the split gave it. The extractor's classifiers no longer run again per group, so they cannot contradict the split or add a model call.

The result retains that classification even when the extraction strategy requests no classification or returns a different one.
