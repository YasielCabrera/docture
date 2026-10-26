---
"docture": minor
---

Choose Tesseract's default concurrency from available CPUs, leaving one CPU free and capping the pool at four workers. Explicit concurrency settings continue to win. Each worker can use about 100 MB, so set concurrency to 1 in memory-constrained hosts.
