---
"@docture/cli": minor
---

Choose stdout and stderr color independently and remove terminal escape controls from machine error messages and hints.

Breaking change. Custom Io implementations must provide stdoutColor. captureIo defaults it to false.

Apply NO_COLOR at the run boundary so custom Io implementations suppress ANSI on both streams.
