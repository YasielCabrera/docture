---
"docture": patch
---

`LlmClassifier` matches the model's answer to a candidate name ignoring surrounding spaces and returns the candidate's own spelling. An exact match wins; a match that ignores case counts only when one candidate fits, and otherwise the classifier abstains with a note. A candidate named `Unknown` can be chosen; `unknown` means abstention only when no candidate has that name.
