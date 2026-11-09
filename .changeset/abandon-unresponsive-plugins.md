---
"docture": patch
---

A loader, classifier, or strategy that ignores its abort signal no longer holds the pipeline past its stage deadline. The pipeline records a `TIMEOUT` attempt, moves to the next component, and leaves the late call to settle. After a caller abort, the pipeline still waits for the call to settle.
