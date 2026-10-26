---
"docture": patch
---

Send every page of an eager split to the model in bounded windows. Join windows only after a seam check confirms the document continues, keeping the earlier classification and lower group confidence. Ignore model page numbers outside their request window.

`maxEagerPages` must be a positive integer.
