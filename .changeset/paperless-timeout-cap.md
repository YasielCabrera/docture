---
"docture": patch
---

`PaperlessSource` rejects a `timeoutMs` above 2147483647, the longest delay a Node timer can wait. A larger value previously expired after 1 ms.
