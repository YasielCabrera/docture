---
"docture": patch
---

`runSplitter` rejects a splitter's groups with `SplitFailedError` when they repeat a page, leave a page out, name a page the bundle does not have, or include a group with no pages. The message names the pages and each empty group. The error carries `coverage` with the `overlaps`, `missing` and `unknown` page numbers and includes it in `toJSON()`. Its hint says to return groups that cover every page once, instead of the image-splitter advice.
