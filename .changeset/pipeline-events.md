---
"docture": minor
---

Add `onEvent` to extraction options and `ConvertOptions`. It receives `PipelineEvent` objects as they happen: `load`, `classify`, each finished `attempt` (the same object the result lists), and a `page` event per analyzed page during conversion. A listener that throws, or returns a promise that rejects, is logged and ignored. The pipeline does not wait for a returned promise.
