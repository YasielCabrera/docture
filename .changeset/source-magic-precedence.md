---
"docture": patch
---

Use specific magic bytes to correct generic or conflicting known media types, including HTTP content types. Strip declaration parameters and lowercase the declared type, while preserving ZIP-based types and declarations for bytes without a known signature. Require the WEBP marker when recognizing RIFF files.
