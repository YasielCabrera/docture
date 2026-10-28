---
"@docture/cli": patch
---

`docture review` now disposes the configured `loaders` it renders pages with when the config also supplies a built `converter` or `extractor`, and when the review fails before it starts, such as a missing input file or an unreadable schema. Before, a rendering loader's workers or engines could stay alive after the review finished or failed. Each configured loader is disposed once, including a loader the config also passes to its own converter or extractor.
