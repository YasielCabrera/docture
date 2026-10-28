---
"docture": minor
"@docture/cli": minor
---

Report `minOcrConfidence` on field citations: the lowest OCR span confidence behind a verified match, or across the cited lines of a cited-unverified value. It is absent unless every relevant span has a score and each cited line's text is its spans joined by single spaces. `docture review` shows it beside each field.
