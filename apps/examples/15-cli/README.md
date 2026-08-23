# 15-cli — The command line

> `inspect`, `extract`, `classify`, `eval`, a schema module, a kinds module, and a config file.

**Needs:** `pnpm fetch`. `inspect` needs no key; `extract` and `classify` work keyless through the config in this folder.

```sh
pnpm --filter @docture/examples cli
```

Docs: [`guides/cli`](../../docs/content/docs/guides/cli.mdx)

## What you learn

Three files are what the CLI needs from you:

| File | Flag | What it is |
|---|---|---|
| [`schema.ts`](./schema.ts) | `--schema` | the shape you want |
| [`kinds.ts`](./kinds.ts) | `--classifications` | the candidate document kinds |
| [`docture.config.ts`](./docture.config.ts) | `--config` | the wiring, when flags are not enough |

`index.ts` runs the commands and shows their output, so you can see what each is for
before typing it.

## The thing worth noticing

`docture.config.ts` wires the deterministic parsers from
[`shared/parsers/`](../shared/parsers) and the classifier from
[example 10](../10-classification). So this works, with no API key:

```sh
docture extract documents/invoice-odoo.pdf --config 15-cli/docture.config.ts
```

```
✓ invoice-odoo.pdf → odoo-invoice-parser via pdfjs · 439ms
{ "invoiceNumber": "INV/2023/03/0008", … }
```

A config file hands you **the actual library** rather than a description of it — your
loaders, your strategies, your model instance, constructed by your imports. The CLI is a
shell over the same API the other examples use, not a lesser interface with its
own ideas about what is possible.

Anything on the command line still wins over the config: a config is a default, never an
override.

## `inspect` is the one to remember

It is the answer to "why did no strategy run?" — it loads the document exactly as
`extract` would and prints the features eligibility is decided from. No model, no key.

```
invoice-odoo.pdf
  loader      pdfjs
  form        digital
  text        1,043 chars
  geometry    yes
  renderable  no

  a strategy requiring TEXT_LAYER ✓  GEOMETRY ✓  RENDERABLE_PAGES ✗
```

And `--json` makes it pipeable, which is where a CLI earns its place:

```sh
docture inspect documents/*.pdf --json | jq -r 'select(.form=="scanned") | .file'
```

## `eval` as a CI gate

`docture eval` prints the same Markdown scoreboard example 12 prints, then exits 1 if
`--min-f1` is not met. The truth-completeness trap from
[example 12](../12-accuracy-and-batch) applies here in full: a partial answer key will
report hallucinations that are not hallucinations.

## What to read next

Back to the top: [the index](../README.md).
