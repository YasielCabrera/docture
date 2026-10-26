---
"docture": patch
---

Pass contract and selected classification hints through `StrategyContext.hints` to LLM text and vision prompts. Context hints appear before the strategy's classification-specific hints.

Process forwards the selected kind's hints, falling back to its extraction contract's hints, without adding classifier calls. A selection with no guidance does not borrow another candidate's hints. Existing classifier calls, verdicts and usage remain unchanged.

Outside Process, a `Contract` that defines `hints` sends them, including an empty string, even when the extractor or the call supplies other candidates. A `Contract` without hints uses the hints of the candidate the classification names. When no candidate is named, a sole candidate's hints apply only to a bare schema or a `Contract` with the same name, so an unrelated candidate no longer supplies hints for a different contract.
