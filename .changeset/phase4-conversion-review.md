---
"@docture/cli": minor
---

`docture review <file> -o review.html [--dpi 96]` writes one self-contained HTML file that draws every conversion element's box over the rendered page, with its id, kind, and escaped text. Boxes use percentages of the page size. A table or paragraph that continues onto later pages gets one box per page, running headers and footers are visible, and tables keep their merged cells. `docture review --conversion report.json --source report.pdf` reviews a saved version 1 or 2 `convert --to json` file; malformed JSON exits 2. Page images are data URIs and a Content-Security-Policy blocks network requests. `--dry-run` and `help --json` cover the command.
