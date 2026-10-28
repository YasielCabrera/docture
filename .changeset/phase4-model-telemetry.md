---
"docture": minor
---

Tag every model call for AI SDK telemetry. Text and vision extraction, classification, layout analysis, both splitters, and repairs now pass `telemetry` to the AI SDK with a fixed `functionId` (`docture.<stage>.<component>`, for example `docture.extract.llm`) and a `docture` runtime-context entry naming the source file, pages, and chunk. `recordInputs` and `recordOutputs` default to `false` for docture's calls, which changes the AI SDK default when a global integration is registered. They are flags that integrations honour, not filters: the AI SDK still passes prompts and answers to each integration's callbacks, so check that every integration you register honours them. Configure it with `telemetry: LlmTelemetryOptions` on each component or once on `LLM`; `documentLabel: false` keeps file names out. `StrategyContext`, `ClassifyContext`, and `SplitContext` gain an optional `documentLabel`.
