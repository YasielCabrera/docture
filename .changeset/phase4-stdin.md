---
"@docture/cli": minor
---

A `-` file argument reads the document from stdin in `extract`, `convert`, `inspect`, `classify`, and `eval`. The result is labelled `stdin`, and directory output is named `stdin.json` or `stdin.<extension>`. Passing `-` twice exits 2 before stdin is read. `eval` accepts stdin only as its single input and only with `--truth <file>`.

Breaking for code that implements `Io` itself: `Io` now requires `readStdin(signal?): Promise<Uint8Array>`. Return an empty `Uint8Array` if your host has no stdin. `captureIo({ stdin })` supplies the bytes in tests.
