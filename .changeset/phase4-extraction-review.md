---
"@docture/cli": minor
---

`docture review <file> --schema <path> --model <provider/id>` extracts with citations and lists every present field beside the page images with its citation status. Selecting a field, by click or with the arrow keys, highlights exactly the lines it cites; an uncited field highlights nothing. `docture review --extraction result.json --source original.pdf` reviews a saved `extract --full` result, validated first; an envelope with several results needs `--item <n>`. The page holds one small inline script, allowed by hash, and makes no network requests.
