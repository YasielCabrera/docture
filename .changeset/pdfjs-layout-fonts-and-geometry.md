---
"docture": patch
---

The pdf.js loader now reads bold, italic and the real font name in layout mode, including abbreviated embedded names such as `NimbusRomNo9L-Medi`. It gives rotated text a rotated box, and places images drawn inside Form XObjects through the form's matrix. Outside layout mode it no longer reports `bold: false` for fonts it never loaded.
