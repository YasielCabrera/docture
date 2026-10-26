---
"docture": patch
---

Retry failed lazy initialization in PDF.js, MuPDF, canvas, Tesseract, and PaddleOCR adapters. Concurrent calls continue to share one initialization attempt.
