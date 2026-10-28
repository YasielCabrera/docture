---
"@docture/cli": minor
---

`docture help --json`, `docture help <command> --json`, and `docture <command> --help --json` print the command specs as a version 1 envelope with command `help`. Each result lists the command's positionals and flags with short aliases, choices, default labels, and descriptions, and the summary lists the environment variables. The parser now rejects a value outside a flag's documented choices, and `docture help <unknown>` exits 2 instead of printing the overview.
