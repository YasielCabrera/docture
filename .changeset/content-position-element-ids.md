---
"docture": minor
---

Converted element IDs now come from each element's content and position instead of its order on the page. An ID is `p<page>-` followed by 12 hex characters of a SHA-256 digest over the identity class, the page, the rounded left and top position, and the normalized content, so inserting an unrelated element no longer renames later elements or the chunks built from them. Page breaks keep `p<page>-page-break`, exact duplicates get `-2`, `-3`, and so on, and `sourceIds` and `lineIds` keep their loader and canonical line IDs.

This changes every ID that conversion produces. Old ordinal IDs such as `p1-text-4` are not mapped to the new scheme: convert the source again to get the new IDs, and update layout analyzers or tests that hard-coded ordinal element IDs to read IDs from `ctx.document`. Saved JSON documents with ordinal IDs still parse unchanged.
