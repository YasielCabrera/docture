---
"docture": patch
---

Neutralize document and excerpt delimiters embedded in input text so the text cannot close its own prompt wrapper. Preserve other text and prompt bytes when no matching tag occurs.

Expose `wrapUntrusted(tag, text)` from the prompt utilities for the same deterministic wrapping behavior.
