# @docture/cli

Extraction from a terminal.

```sh
npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
```

```json
{
  "invoiceNumber": "INV-2026-4311",
  "issuedAt": "2026-03-14",
  "total": 1284.5
}
```

**stdout is the data. stderr is the story.** So the command above pipes into `jq`, and
still tells you which strategy answered and what it cost:

```
✓ invoice.pdf → llm via pdfjs · 2.1s · 3,412 tokens · $0.0041
```

---

## Commands

| | |
|---|---|
| `extract <file...>` | Extract structured data |
| `classify <file...>` | Decide what kind of document it is, without extracting |
| `inspect <file...>` | What the loaders see. **No model, no API key** |
| `eval <file...>` | Score against ground truth, and gate CI on the number |

`docture <command> --help` for the flags.

## The schema

`--schema` points at a module. Zod, Valibot, ArkType, anything the library takes.

```ts
// invoice.ts
import { z } from "zod";

export default z.object({
  invoiceNumber: z.string().describe("The invoice number, top-right"),
  total: z.number(),
});
```

TypeScript works with no build step and no transpiler dependency: Node strips the types
itself from 22.18 on. A module may export `default`, `schema`, or one thing; point at a
specific export with `--schema ./schemas.ts#Invoice`.

A `.json` file is taken as raw JSON Schema. It will steer the model, but it **cannot
check the answer.** There is no validator attached to one, and this package will not
grow a JSON Schema engine to invent it. The run says so before it prints anything.

## The model

`--model <provider>/<model-id>`, resolved in three steps, and the CLI tells you which
one happened (`--verbose`):

1. `--gateway` → straight to the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).
2. The provider package as resolved from your working directory, so your
   `@ai-sdk/openai`, your version, your credentials.
3. Failing that, the gateway. If no gateway credential is set either, that is a warning
   *before* the first request rather than a 401 after it.

```sh
docture extract invoice.pdf -s ./invoice.ts -m openai/gpt-5
docture extract invoice.pdf -s ./invoice.ts -m anthropic/claude-opus-5
docture extract invoice.pdf -s ./invoice.ts -m bedrock/claude-opus-5
```

## Scans

A scanned PDF has no text layer, so no text strategy is a candidate for it. `--vision`
renders the pages and adds a vision strategy:

```sh
docture extract scan.pdf -s ./invoice.ts -m openai/gpt-5 --vision --dpi 200
```

Rendering comes from `@docture/raster-canvas`, the one **optional** dependency here: it
carries a native binding, and a platform with no prebuild should still be able to install
a CLI that reads text. Missing, `--vision` says so by name.

## Batches

Every command takes many files. `extract` runs four at a time (`--concurrency`), yields
each as it finishes, and never lets one bad document sink the rest:

```sh
docture extract 'invoices/*.pdf' -s ./invoice.ts -m openai/gpt-5 --out out/ --cache .cache
```

- `--out <dir>` writes `out/<name>.json` per document; `--out <file>` collects one.
- `--format ndjson` streams `{ file, ok, data }` per line as each finishes.
- `--full` adds `method`, `loader`, `attempts`, `usage` and `features` to each record.
- `--cache <dir>` caches model responses, so re-running a corpus after a schema tweak
  only pays for what changed.

Exit codes: **0** everything worked · **1** a document failed · **2** the command was
wrong. A CI job wants that distinction, since 2 will fail identically on every rerun.

## Why did nothing run?

`inspect` needs no model and no key, and prints the features eligibility is actually
decided from:

```sh
$ docture inspect scan.pdf
scan.pdf
  loader      pdfjs
  type        application/pdf
  pages       3
  form        scanned
  text        0 chars
  geometry    no
  renderable  no

  a strategy requiring TEXT_LAYER ✗  GEOMETRY ✗  RENDERABLE_PAGES ✗
```

It is not a second implementation of that logic. A probe strategy is pushed onto a real
pipeline and reports the `features` core handed it, so what you read here is by
construction what routing used.

## docture.config.ts

When flags stop being enough, wire it in TypeScript. The config hands you the actual
libraries rather than a description of them:

```ts
import { defineConfig } from "@docture/cli";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { llm } from "@docture/llm";
import { openai } from "@ai-sdk/openai";
import { Invoice } from "./schemas/invoice.js";
import { tableParser } from "./strategies/table.js";

export default defineConfig({
  loaders: [new DocumentLoaderPdfJs()],
  // Declaration order is the routing policy: the free parser goes first.
  strategies: [tableParser, llm({ model: openai("gpt-5") })],
  schema: Invoice,
  cacheDir: ".docture-cache",
});
```

That needs no flags at all. `docture extract invoice.pdf` is the whole command. The
nearest `docture.config.{ts,mts,js,mjs}` walking up from the working directory is used;
`--config` points elsewhere and `--no-config` ignores it.

Anything on the command line still wins over anything in here: a config is a default,
never an override. Where it cannot be, the run says so. A config that supplies its own
`strategies` makes `--model` meaningless, and the run reports the flag as ignored rather
than quietly
dropping it.

| Key | |
|---|---|
| `loaders`, `strategies`, `classifiers`, `classifications`, `policy` | passed to `createExtractor` |
| `model`, `vision`, `instructions`, `pricing` | build the default LLM strategies |
| `schema` | used when `--schema` is omitted |
| `cacheDir`, `concurrency`, `stageTimeoutMs` | run defaults |
| `extractor` | a built `Extractor`. Total control; everything above is ignored |

## Accuracy

`eval` extracts a corpus, scores it field by field with `@docture/eval`, the same grader
the library's own tests use, and exits 1 below the gate.

```sh
docture eval 'corpus/*.pdf' -s ./invoice.ts -m openai/gpt-5 \
  --truth corpus/truth --min-f1 0.95 --report score.md
```

Ground truth is `--truth <dir>/<name>.json`, or a `<name>.expected.json` beside each
document. A missing truth file fails the run before anything is sent to a model,
scoring a document against nothing and calling it 1.0 would be the worst thing this
command could do.

## As a library

`run` is the entire CLI as a function of argv and an IO seam, which is how it is tested
and how you would wrap it:

```ts
import { captureIo, run } from "@docture/cli";

const io = captureIo({ cwd: process.cwd(), env: process.env });
const code = await run(["extract", "invoice.pdf", "-s", "./invoice.ts"], { io });
```

## License

MIT
