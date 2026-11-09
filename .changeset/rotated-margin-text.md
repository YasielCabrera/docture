---
"docture": patch
---

The pdf.js and MuPDF loaders report a `rotation` on runs that are not horizontal, and rotated words form their own lines. Conversion keeps rotated text such as an arXiv side stamp out of headings and body paragraphs and places it after the page body.
