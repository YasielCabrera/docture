---
"@docture/cli": minor
---

Add `@docture/cli`, the `docture` command line: `extract`, `classify`, `inspect` and
`eval`.

```sh
npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
```

**stdout carries the data and stderr carries the story**, so the command above pipes into
`jq` while still reporting which strategy answered, what it cost, and every attempt that
failed first. Exit codes separate "a document failed" (1) from "the command was wrong" (2),
which is the distinction a CI job needs.

`--schema` takes a module. Zod, Valibot, ArkType, or a `.json` JSON Schema, with no build
step, because Node strips TypeScript itself from 22.18 on. `--model <provider>/<model-id>`
resolves the provider package from the working directory and falls back to the AI Gateway,
saying which route it took and warning about a missing credential *before* the first request.
When flags are not enough, `docture.config.ts` supplies real loaders, strategies and a real
model instance built by your own imports; a flag always wins over it, and where it cannot,
the run says the flag was ignored.

`inspect` needs no model and no API key. It answers "why did no strategy run?", and
it reports the features core actually routed on rather than re-deriving them. `eval` scores a
corpus with `@docture/eval` and exits 1 below `--min-f1`.

The only heavy dependency is optional: `@docture/raster-canvas` carries the one native binding
in the tree, so a platform without a prebuild can still install a CLI that reads text, and
`--vision` fails by name rather than at install time.
