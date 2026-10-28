---
"@docture/cli": minor
---

`--dry-run` on `extract`, `convert`, `classify`, and `eval` resolves and validates the config, schema, inputs, output targets, truth files, model route, credentials, and wiring, then prints one JSON plan envelope with `summary: { dryRun: true }` and exits 0. Each result's `plan` names the input, loaders, strategies, classifiers, model, schema, and output target. It loads no document, reads no stdin, calls no model, and creates no output or cache directory. An extractor or converter factory from the config is not called and is reported as `opaque: true`. An invalid invocation still exits 2.
