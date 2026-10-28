---
"docture": minor
"@docture/cli": patch
---

`page.image()` accepts a per-call signal as its second argument, `{ signal }`. An aborted call rejects with the signal's reason and cancels its render once no other caller waits for it; a cancelled render is not memoized. The vision strategy and `ImageSplitter` pass their signal, the OCR loaders honour it, and `NapiCanvasRasterizer` cancels the active PDF.js render task on abort. `docture review` and `docture inspect --render` stop rendering when the command is cancelled, and inspect reports the cancellation instead of a render error.
