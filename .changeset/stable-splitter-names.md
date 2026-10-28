---
"docture": patch
---

`TextSplitter` and `ImageSplitter` default to the names `"TextSplitter"` and `"ImageSplitter"` instead of the runtime class name, so a minified bundle or a subclass keeps the splitter's telemetry `functionId` and component name. An explicit `name` still wins.
