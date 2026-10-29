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
| `convert <file...>` | Convert PDFs to TXT, Markdown, HTML, or JSON |
| `classify <file...>` | Decide what kind of document it is, without extracting |
| `inspect <file...>` | What the loaders see. **No model, no API key** |
| `eval <command>` | Run, report, compare and gate evaluations from `docture.eval.ts`, or score files against ground truth |
| `synth <command>` | Generate labeled synthetic documents and corpora from `docture.synth.ts` |
| `review [file]` | Write an offline HTML page of boxes or cited fields over the page images |
| `mcp` | Serve `convert` and `inspect` to an agent host over MCP stdio |

`docture <command> --help` for the flags. `docture help --json` (or `docture --help --json`)
prints every command as a version 1 envelope; `docture help extract --json` and
`docture extract --help --json` print one. Each spec lists positionals and flags with
their choices and defaults, and `summary.environment` lists the environment variables.

## Output

`extract`, `convert`, `classify`, `inspect`, and `eval run` accept `--format json|ndjson|text`.
`extract` defaults to JSON; the others default to text. These commands no longer accept
`--json`; only the help route does. A `--format` value outside its choices exits with
code 2.

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
| `eval` with files | `score` with `f1`, `precision`, `recall`, `exactMatch`; `method`, `usage` |

Quick-mode eval adds `summary` with `documents`, `meanF1`, `meanPrecision`, `meanRecall`,
`exactMatches`, `totalCostUsd`, `totalTokens`, `wallMs`, `byMethod`, `byField`, `failed`,
`passed`, `reasons`, and the configured `minF1` and `maxCostUsd`. The means are
per-document: a failed extraction scores 0, and an empty denominator scores 1. `byField`
folds array indexes into `[]`. The summary also holds the eval run's `runId`, `metrics`,
per-path `fields`, `gate`, and, with `--calibrate`, `calibration`. Its top-level `ok` also
reflects the gate. Text output prints the Markdown scoreboard, and `--report` writes it
regardless of stdout format. The other eval subcommands print eval's own versioned records with
`--format json`: an eval result, a run comparison, a gate verdict or the run list.

`--quiet` keeps each failure and the first hint per error code on stderr while hiding
success, progress, warning, and summary diagnostics. Result output still follows the
selected format.

## Conversion

```sh
docture convert reports/*.pdf --out converted/
```

Conversion requires an output directory. Markdown and referenced raster assets are the
defaults. Use `--to md|html|txt|json`, `--assets referenced|embedded|omit`, and optional
`--assist-layout --model <provider/id>`. A scan needs an OCR loader in the config.

## Review

```sh
docture review report.pdf -o review.html
docture review --conversion report.json --source report.pdf
docture review invoice.pdf --schema ./invoice.ts --model openai/gpt-5
docture review --extraction results.json --source invoice.pdf --item 0
```

`review` writes one self-contained HTML file, `review.html` by default. Page images are
inlined as data URIs at `--dpi` (default 96), and a Content-Security-Policy blocks every
network request. It renders pages with the configured loaders, or PDF.js and
`@napi-rs/canvas`.

Without `--schema` or `--model` it converts the document and draws every element's box
over its page, with the element id, kind, and text. A table or paragraph that continues
onto later pages gets one box per page. Running headers and footers are boxes of their
own, and tables keep their merged cells. `--conversion` reads a saved `convert --to json`
file, version 1 or 2, instead of converting. A saved file has no page images, so
`--source` names the document it came from.

With `--schema` or `--model` it extracts with citations and lists every present field
beside the pages with its status: `verified`, `cited-unverified`, or `uncited`. Selecting a
field, or moving to it with the arrow keys, highlights the exact lines it cites. An uncited
field highlights nothing. A field read from OCR also shows its lowest OCR confidence.
`--extraction` reads a saved `extract --full` result: one record,
or an envelope. An envelope with several results needs `--item <n>`. A result saved
without `--citations` lists its fields as not requested. Malformed saved JSON exits 2
before any page is rendered.

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
3. Failing that, the gateway. Missing known provider or gateway credentials fail before
   loading documents. With `--cache`, the CLI warns instead because a cache hit needs no
   request. An OpenAI-compatible `OPENAI_BASE_URL` also permits a keyless local endpoint.

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
loader. See the [complete OCR and engine recipes](../../apps/docs/content/docs/getting-started/installation.mdx).

## Batches

Every command takes many files. `extract` runs four at a time (`--concurrency`), yields
each as it finishes, and never lets one bad document sink the rest:

```sh
docture extract 'invoices/*.pdf' -s ./invoice.ts -m openai/gpt-5 --out out/ --cache .cache
```

- `--out <dir>/` writes one result item to `out/<name>.json`, including failures.
  With one input, `--out <file>` writes the envelope.
- `--format ndjson` streams one result item per line as each finishes.
- `--full` adds `method`, `loader`, `attempts`, `usage`, `features`, optional
  `classification`, `validation`, and optional `conflicts` to successful extraction items.
- `--citations --full` also adds `citations`, one `{ path, ids, status }` per value, and
  `citationSources`, the cited lines with their boxes. `--citations` needs `--full`.
- `--cache <dir>` caches model responses, so re-running a corpus after a schema tweak
  only pays for what changed.

Exit codes: **0** everything worked · **1** a document failed · **2** the command was
wrong. A CI job wants that distinction, since 2 will fail identically on every rerun.

## Standard input

A `-` file argument reads the document from stdin, for every command except `mcp`:

```sh
curl -s https://example.com/invoice.pdf | docture extract - -s ./invoice.ts -m openai/gpt-5
```

The result is labelled `stdin`. Pass `-` at most once. `eval` reads stdin only as its
single input and only with `--truth <file>`. Stdin has no file name, so the format comes
from the leading bytes alone: PDF, PNG, JPEG, GIF, TIFF, and WebP work. HTML, plain text,
Markdown, and ZIP-based Office files fail with `NO_ELIGIBLE_LOADER`; pass them as a path.

## Dry run

`--dry-run` on `extract`, `convert`, `classify`, `eval`, and `review` resolves the config, schema,
inputs, output targets, truth files, model route, credentials, and wiring, then prints one
JSON plan envelope with `summary.dryRun: true` and exits 0. It loads no document, reads no
stdin, calls no model, calls no config factory, and creates no output or cache directory.
An invalid invocation still exits 2; a missing `eval` truth file exits 1.

## MCP server

`docture mcp` serves two model-free tools, `convert` and `inspect`, to an agent host over
MCP stdio. It needs the optional peer `@modelcontextprotocol/sdk`; the other commands
never load it:

```sh
npm install --save-dev @docture/cli @modelcontextprotocol/sdk@1.32.2
```

```json
{ "mcpServers": { "docture": { "command": "npx", "args": ["docture", "mcp"] } } }
```

Both tools take a `source` and optional one-based `pages`; `convert` also takes `format`.
Each tool call returns the version 1 envelope as structured content and JSON text, and
sets `isError` when an item failed, including a config that fails to load or build.
Malformed arguments and `-` as a source are JSON-RPC invalid-parameter errors. Stdout
carries only protocol frames. `createMcpServer` from `@docture/cli/mcp` builds the same
server for any MCP transport.

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
import { defineConfig } from "@docture/cli/config";
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

`docture eval` is a thin shell over [`@docture/eval`](../eval). Describe the dataset, the
spec and the processors once in `docture.eval.ts`:

```ts
import { defineEval, exact } from "@docture/eval";
import { defineEvalConfig } from "@docture/eval/config";
import { fromDocture } from "@docture/eval/docture";
import { folderDataset } from "@docture/eval/node";

export default defineEvalConfig({
  dataset: folderDataset("dataset", { documents: "doc.pdf", expected: "expected.json" }),
  spec: defineEval(Invoice, { strings: exact() }),
  experiments: { llm: fromDocture(extractor, Invoice) },
  gate: { thresholds: [{ metric: "f1", min: 0.95 }] },
  baseline: "auto",
});
```

| | |
|---|---|
| `eval run` | Run every experiment, store the run, write reporters, print the scoreboard and apply the gate |
| `eval report <run>` | Re-render a stored run; `--rescore` scores its raw outputs again with the current spec |
| `eval compare <base> <candidate>` | Paired comparison with bootstrap or McNemar tests, as Markdown or JSON |
| `eval gate <run>` | Apply the config's gate to a stored run, optionally against `--baseline` |
| `eval runs` | List stored runs, newest first |
| `eval validate` | Check every case's ground truth against the spec and list all problems |
| `eval sample --size <n>` | Print the ids of a deterministic stratified sample |
| `eval migrate <module>` | Preview a ground-truth migration; `--write` applies it |
| `eval draft`, `eval sign-off <id>` | Draft truth with one experiment, then mark it reviewed |

`eval run` takes `--experiment`, `--sample` with `--strata` and `--seed`, `--cases`,
`--epochs`, `--concurrency`, `--resume <runId|latest>`, `--baseline <runId|auto|none>`,
`--no-gate` and `--store`. A `<run>` argument is a run id, `latest`, or a directory holding
`result.json`. Runs are stored in the config's `store`, by default `.docture/eval` beside
the config.

`--reporter` takes `terminal`, `html`, `md`, `json`, `csv`, `junit` or a module path,
comma-separated or repeated, and replaces the config's reporters for that command. Files
go to `--out` (default `eval-report`): `report.html`, `report.md`, `result.json`,
`cases.csv` and `junit.xml`. A module exports a reporter, as `default` or `reporter`, or a
function `(result) => string` whose text is written to its exported `fileName` or to
`<module name>.txt`. The text scoreboard always prints, so `terminal` changes nothing.

Exit codes are 0 for a pass, 1 for a failed gate or an interrupted run, and 2 for a usage
error. A run without a configured gate exits 0 and says that no gate ran.

### Quick mode

Files without a config score each document against its ground truth with the loose
comparisons of `looseEval`:

```sh
docture eval 'corpus/*.pdf' -s ./invoice.ts -m openai/gpt-5 \
  --truth corpus/truth --min-f1 0.95 --report score.md
```

`docture eval run <files...>` is the same command. Ground truth is
`--truth <dir>/<name>.json`, or a `<name>.expected.json` beside each document. A missing
truth file fails the run before anything is sent to a model. Scoring a document against
nothing and calling it 1.0 would be the worst thing this command could do.

A failed extraction is an errored case. Its expected fields count as omissions, it fails
the command with exit code 1, and it stays in the scoreboard and the gate.

## Synthetic documents

`docture synth` is a thin shell over [`@docture/synthetic`](../synthetic). Rendering needs
`pdfkit`, and degraded renditions also need `sharp`. Install both beside the CLI:

```sh
npm install --save-dev @docture/synthetic pdfkit sharp
```

Describe the model and templates once in `docture.synth.ts`:

```ts
import { defineSynthConfig } from "@docture/synthetic";
import { digital, scan } from "@docture/synthetic/node";

export default defineSynthConfig({
  model: invoiceModel,
  templates: [classic, modern],
  scenarios: [manyItems],
  seeds: [1, 2, 3],
  renditions: [digital(), scan({ severity: 0.3 })],
  createdAt: "2025-06-01T00:00:00Z",
});
```

| | |
|---|---|
| `synth list` | The templates with their aliases and family, the scenarios, and the rendition profiles |
| `synth gen --seed <seed>` | Print one sampled value as JSON |
| `synth render --seed <seed> --out <file>` | Write one document, and its expected value and labels to `<file>.labels.json` |
| `synth corpus` | Write a corpus that `jsonlDataset` from `@docture/eval/node` reads |
| `synth verify <corpus>` | Read every digital case back through PDF.js and confirm its labels |

`gen` and `render` take `--scenario <name>`; `render` also takes `--template <selector>`
and `--rendition`. A rendition is `digital` or a profile with a severity from 0 to 1:
`scan:0.3`, `scan-lq:0.5`, `photo:0.6` or `fax:0.5`. A seed of digits is a number and
anything else is a string, so `7` and `"7"` give different samples.

`corpus` takes `--out`, `--seeds 1-40` or `--seeds 1,2,3`, `--templates`, `--scenarios`,
`--renditions` and `--concurrency`. Each flag replaces the config's value. The corpus goes
to the config's `out`, by default `corpus` beside the config. Rerunning converges: a case
whose inputs and files are unchanged is skipped. `render` and `corpus` read each digital
rendering back before writing it; `--no-verify` skips that.

Exit codes are 0 when every case was written or verified, 1 when a case failed, and 2 for
a usage error. `corpus` prints the manifest path on stdout and lists failed cases on stderr.

## As a library

`run` is the entire CLI as a function of argv and an IO seam, which is how it is tested
and how you would wrap it:

```ts
import { captureIo, run } from "@docture/cli";

const io = captureIo({ cwd: process.cwd(), env: process.env });
const code = await run(["extract", "invoice.pdf", "-s", "./invoice.ts"], { io });
```

## Import migration

The published packages are `docture`, `@docture/cli`, `@docture/eval`, and `@docture/synthetic`. In configs, replace `@docture/core`
with `docture`, `@docture/llm` with `docture/llm` or a narrow model entry, and old
`@docture/loader-*` imports with `docture/loaders/*`. Core is the only API at the
`docture` root. `LLM` comes from `docture/llm`; `llm()` comes from `docture/llm/text`.
The [migration guide](../../apps/docs/content/docs/resources/migration.mdx) lists every replacement.

## License

MIT

`--concurrency` overlaps model calls and file or network I/O. Local PDF parsing and rendering run on one thread. Higher concurrency does not make CPU-bound PDF work parallel. To keep a server responsive during that work, use `worker_threads` or a separate process.

## Environment and credentials

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Credential for the locally installed model provider. |
| `ANTHROPIC_API_KEY` | Credential for the locally installed model provider. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Credential for the locally installed model provider. |
| `MISTRAL_API_KEY` | Credential for the locally installed model provider. |
| `GROQ_API_KEY` | Credential for the locally installed model provider. |
| `XAI_API_KEY` | Credential for the locally installed model provider. |
| `DEEPSEEK_API_KEY` | Credential for the locally installed model provider. |
| `COHERE_API_KEY` | Credential for the locally installed model provider. |
| `PERPLEXITY_API_KEY` | Credential for the locally installed model provider. |
| `CEREBRAS_API_KEY` | Credential for the locally installed model provider. |
| `FIREWORKS_API_KEY` | Credential for the locally installed model provider. |
| `TOGETHER_AI_API_KEY` | Credential for the locally installed model provider. |
| `DEEPINFRA_API_KEY` | Credential for the locally installed model provider. |
| `OPENROUTER_API_KEY` | Credential for the locally installed model provider. |
| `AI_GATEWAY_API_KEY` | Credential when routing through AI Gateway. |
| `VERCEL_OIDC_TOKEN` | Alternative AI Gateway credential. |
| `NO_COLOR` | Disable ANSI color on both streams. |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible endpoint, including keyless local endpoints. |

Known provider routes and gateway model strings require credentials before document
processing. A cache-enabled run may continue without a key to reuse cached responses.
Configured model strings use the SDK gateway route and its credential checks. A
configured provider instance controls its own credentials and supports keyless compatible
endpoints. Missing dependencies name the failed import and suggest installation or a
corrected path. Invalid config fields and unknown keys are usage errors naming the field.

`Io.stdoutColor` controls stdout styling independently of diagnostic `Io.color`. Both
honor `NO_COLOR` and `--no-color`. JSON and NDJSON error messages and hints strip terminal
control sequences.

Quick-mode `eval --min-f1 <number> --max-cost-usd <number>` gates the run's
`meanDocumentF1` and `costUsd` metrics. `meanDocumentF1` is the mean of per-document F1,
with a failed extraction scoring 0, so every document weighs the same. The summary reports
it as `meanF1`, and `metrics.f1` is the field F1 pooled over every field. Cost includes the
billed usage of failed extractions. Failed thresholds exit with code 1, including when
extraction itself succeeds. The output summary contains `passed`, `reasons`, and configured
thresholds. A reason names its flag, such as
`Mean F1 0.500 is below the --min-f1 gate of 0.9.` A cost gate fails when no price is known.
Verbose output includes the worst fields.

`docture eval run` saves the result even when a reporter fails, then prints each reporter
failure on stderr, also under `--quiet`, and exits 1. `docture eval report <dir> --rescore`
reads the run and its raw outputs from that directory and writes the re-scored run to the
configured store or `--store`. `docture.eval.ts` accepts `sections`, such as
`calibrationSection()`, and `fallbackBranch`, the branch `--baseline auto` searches when the
current branch has no complete run.
