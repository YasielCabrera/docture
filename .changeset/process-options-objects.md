---
"docture": patch
---

`Process.extract()` and `splitOnly()` take an options object built with `Object.create(defaults)` or a class as options. Before, any object without a plain prototype was read as the document source.
