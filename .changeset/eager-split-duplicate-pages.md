---
"docture": patch
---

`TextSplitter` and `ImageSplitter` keep a page that the model listed under two documents only in the more confident one, so an eager split never extracts a page twice.
