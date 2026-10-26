---
"docture": patch
---

Terminate Tesseract workers that finish starting during disposal or fail parameter setup. Disposal drains pending worker creation and prevents further recognition on the disposed pool.

Report termination failures consistently for ready and late-starting workers. Reject queued loads after the last startup failure so later loads can retry instead of hanging.
