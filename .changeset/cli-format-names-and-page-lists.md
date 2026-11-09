---
"@docture/cli": minor
---

`convert --to` accepts the library's format names `markdown` and `text` beside `md` and `txt`. `convert --pages` and `inspect --pages` accept ranges such as `2,4-6`, selecting at most 100,000 pages, and `inspect --max-pages` names the first-n-pages limit that a bare `inspect --pages 3` still applies.
