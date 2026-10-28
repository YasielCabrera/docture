---
"docture": patch
"@docture/cli": patch
---

A path or `file:` URL that cannot be read now raises `UnsupportedSourceError` (`UNSUPPORTED_SOURCE`) instead of the raw file-system error. The message names the path and what to do: a missing file, a directory, and a file without read permission each get their own guidance, and `cause` keeps the original error with its `code`, such as `ENOENT`. The CLI reports these as `UNSUPPORTED_SOURCE` with a recovery hint instead of `INTERNAL`, and still exits 1.
