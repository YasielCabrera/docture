# @docture/cli

Extraction and grounded document conversion from a terminal.

```sh
npm install --save-dev @docture/cli @ai-sdk/openai zod@^4
npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
```

```json
{
  "version": 1,
  "command": "extract",
  "ok": true,
  "results": [{
    "file": "invoice.pdf",
    "ok": true,
    "data": { "invoiceNumber": "INV-2026-4311", "issuedAt": "2026-03-14", "total": 1284.5 }
  }]
}
```

A JSON envelope goes to stdout. Pipe values with `jq '.results[0].data.total'`.
Diagnostics go to stderr:

```
✓ invoice.pdf → llm via pdfjs · 2.1s · 3,412 tokens · $0.0041
```

## Installation

Use Node.js 22 or newer. TypeScript configs and schemas need Node 22.18 or newer for
type stripping without a flag. The CLI package requires `docture`, AI SDK 7, and PDF.js.
It attempts to install `@napi-rs/canvas` as an optional default renderer.

For a project-local CLI without a model provider:

```sh
npm install --save-dev @docture/cli
npx docture inspect invoice.pdf
```

For a one-off run without a local install:

```sh
npx --package @docture/cli docture --help
```

`docture` is the executable name. `@docture/cli` is the npm package that supplies it.
A provider package installed in your project, such as `@ai-sdk/openai`, uses the
credentials configured for that provider.

## Commands

| | |
|---|---|
| `extract <file...>` | Extract structured data |
| `convert <file...>` | Convert PDFs to TXT, Markdown, or HTML |
| `classify <file...>` | Decide what kind of document it is, without extracting |
| `inspect <file...>` | What the loaders see. **No model, no API key** |
| `eval <file...>` | Score against ground truth, and gate CI on the number |

`docture <command> --help` for the flags.

## Output

Every command accepts `--format json|ndjson|text`. `extract` defaults to JSON;
`convert`, `classify`, `inspect`, and `eval` default to text. `--json` is removed.

JSON always has the shape `{ version: 1, command, ok, results, summary? }`, for one
or many inputs, including failures. Each result is `{ file, ok: true, ...data }` or
`{ file, ok: false, error: { code, message, hint? } }`. NDJSON streams the same result
items one per line without an envelope. JSON keeps input order; NDJSON uses completion
order. Text prints extracted data, classification tables, inspection reports, or the
eval scoreboard. Conversion writes its documents and assets beneath `--out`.

| Command | Successful result fields |
| --- | --- |
| `extract` | `data`, plus metadata with `--full` |
| `convert` | `output` and `assets` as absolute paths, `warnings` |
| `classify` | `name`, `confidence`, `signals` |
| `inspect` | `loader`, `features`, `pages`, plus requested `text`, `lines`, or `render` |
| `eval` | `score` with `f1`, `precision`, `recall`, `exactMatch`; `method`, `usage` |

Eval adds `summary` with aggregate metrics, `failed`, optional `minF1`, and `passed`.
Its top-level `ok` also reflects the accuracy gate. `--report` always writes a Markdown
scoreboard, regardless of stdout format. A failed document has zero F1, precision, and
recall in that scoreboard and the aggregate.

`--quiet` keeps each failure and the first hint per error code on stderr while hiding
success, progress, warning, and summary diagnostics. Result output still follows the
selected format.

## Conversion

```sh
docture convert reports/*.pdf --out converted/
```

Conversion requires an output directory. Markdown and referenced raster assets are the
defaults. Use `--to md|html|txt`, `--assets referenced|embedded|omit`, and optional
`--assist-layout --model <provider/id>`. A scan needs an OCR loader in the config.

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

Rendering uses the `docture/raster/canvas` entry and the CLI's optional
`@napi-rs/canvas` dependency. It uses a native prebuild. Text extraction remains
available when canvas cannot install. If optional dependencies were omitted, restore
the renderer explicitly:

```sh
npm install --save-dev @docture/cli @napi-rs/canvas@1.0.10
```

For OCR with Tesseract and canvas in a custom config:

```sh
npm install --save-dev @docture/cli docture tesseract.js@7.0.0 pdfjs-dist@6.2.108 @napi-rs/canvas@1.0.10
```

Import `DocumentLoaderTesseract` from `docture/loaders/tesseract` and
`NapiCanvasRasterizer` from `docture/raster/canvas`, then pass the rasterizer to the OCR
loader. See the [complete OCR and engine recipes](../../apps/docs/content/docs/guides/installation.mdx).

## Batches

Every command takes many files. `extract` runs four at a time (`--concurrency`), yields
each as it finishes, and never lets one bad document sink the rest:

```sh
docture extract 'invoices/*.pdf' -s ./invoice.ts -m openai/gpt-5 --out out/ --cache .cache
```

- `--out <dir>/` writes one result item to `out/<name>.json`, including failures.
  With one input, `--out <file>` writes the envelope.
- `--format ndjson` streams one result item per line as each finishes.
- `--full` adds `method`, `loader`, `attempts`, `usage`, `features`, and optional
  `classification` to successful extraction items.
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
libraries rather than a description of them. Declare the config's imports directly:

```sh
npm install --save-dev @docture/cli docture pdfjs-dist@6.2.108 ai@^7 @ai-sdk/openai zod@^4
```

```ts
import { defineConfig } from "@docture/cli";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { llm } from "docture/llm/text";
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
| `converter`, `layoutAnalyzer` | a built `DocumentConverter`, or its optional layout refinement |

## Accuracy

`eval` extracts a corpus, scores it field by field with `docture/eval`, the same grader
the library's own tests use, and exits 1 below the gate.

```sh
docture eval 'corpus/*.pdf' -s ./invoice.ts -m openai/gpt-5 \
  --truth corpus/truth --min-f1 0.95 --report score.md
```

Ground truth is `--truth <dir>/<name>.json`, or a `<name>.expected.json` beside each
document. A missing truth file fails the run before anything is sent to a model,
scoring a document against nothing and calling it 1.0 would be the worst thing this
command could do.

Failed extractions score F1, precision, and recall zero and remain in the scoreboard,
report, and accuracy gate.

## As a library

`run` is the entire CLI as a function of argv and an IO seam, which is how it is tested
and how you would wrap it:

```ts
import { captureIo, run } from "@docture/cli";

const io = captureIo({ cwd: process.cwd(), env: process.env });
const code = await run(["extract", "invoice.pdf", "-s", "./invoice.ts"], { io });
```

## Import migration

Only `docture` and `@docture/cli` are published. In configs, replace `@docture/core`
with `docture`, `@docture/llm` with `docture/llm` or a narrow model entry, and old
`@docture/loader-*` imports with `docture/loaders/*`. Core is the only API at the
`docture` root. `LLM` comes from `docture/llm`; `llm()` comes from `docture/llm/text`.
The [migration guide](../../apps/docs/content/docs/guides/migration.mdx) lists every replacement.

## License

MIT
