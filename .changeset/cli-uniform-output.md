---
"@docture/cli": minor
---

Use one versioned JSON output envelope for `extract`, `convert`, `classify`, `inspect`, and `eval`: `{ version: 1, command, ok, results, summary? }`. Result items include the file and either successful command data or a structured error with a required code, message, and optional hint. Failures remain in every machine-readable output.

Breaking changes:

- `extract` defaults to this envelope for one or many inputs, including failures. Replace `jq .total` with `jq '.results[0].data.total'`. `--full` adds metadata to successful items without changing the envelope.
- `--format json|ndjson|text` selects result output on every command. `classify --json` and `inspect --json` are removed. The other commands keep text as their default.
- `convert --format md|html|txt` becomes `convert --to md|html|txt`. `--format` now selects result encoding. JSON conversion results list the written document, assets, and warnings.
- `extract --out <file>` writes the selected run output, with an envelope for JSON. Directory output writes one result item per file, including failures, instead of bare extracted data.
- `extract` refuses known aliases of local inputs in `--out` destinations, including through file URLs, symbolic links, or hard links. It also refuses missing files when native parent traversal and terminal symlinks identify the same destination after planned output folders exist. It exits with code `2` before config or schema imports and model resolution and asks for a different destination. Unsafe output takes precedence over invalid config or schema errors. Sources and output files remain untouched on refusal. Directory output may first create empty destination folders; single-file output does not create parents. If permissions or another unknown filesystem error prevent inspecting an input, an existing destination requires a new output path, even if it is unrelated. Uninspectable destinations are also refused. Safe new output paths still retain per-document errors and let other batch inputs continue. Missing inputs and symlink loops retain per-document errors with safe existing destinations.
- NDJSON emits the same result items as `results[]`, one per line in completion order, without an envelope. JSON retains input order.
- `eval --format json` includes aggregate metrics and the accuracy gate verdict in `summary`. Failed document metrics are zero. `--report` continues to write a Markdown scoreboard in all formats.
- `explain()` always returns a code, including `USAGE`, `CLI`, and `INTERNAL` for errors outside the library's error hierarchy.
