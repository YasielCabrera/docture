# 14-testing-your-pipeline — Testing your pipeline

> the in-memory doubles, generated fixtures, conformance suites, and the one place a mock model belongs.

**Needs:** **Nothing.** No download, no key, no network.

This example is a test file rather than a script — see below.

Docs: [`reference/packages`](../../docs/content/docs/getting-started/reference/packages.mdx)

## Imports and installs

Import doubles from `docture/testing/doubles`, generated PDFs from
`docture/testing/fixtures`, and suites from `docture/testing/conformance`. The fixture
test grades extraction with `defineEval` from `@docture/eval`. Doubles need no engine.
Fixtures need `pdfkit`, conformance needs Vitest and fixtures, and the model tests need
`ai/test` from the AI SDK.

For a separate application:

```sh
pnpm add docture ai pdfjs-dist zod
pnpm add -D @docture/eval vitest pdfkit
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## The example here is the test file

```sh
pnpm --filter @docture/examples test 14-testing
```

Read [`pipeline.test.ts`](./pipeline.test.ts). Its deterministic tests run without a key or network.
`index.ts` is a summary of what is in there and why; run it with
`tsx 14-testing-your-pipeline/index.ts`.

## Why this folder uses generated fixtures

The other examples run on real documents, downloaded, because a library that reads
documents is only convincing on documents somebody actually issued.

Tests are the exception. There you want the **same bytes every time**, generated from the
same values as the expected output, so the answer key cannot drift from the document.
`makeInvoicePdf({ seed })` returns the PDF *and* the data it rendered — the failure mode
where a fixture is updated and its `.json` is not simply cannot happen.

A test corpus that needs a network is a test corpus that fails on a plane.

## Test the wiring without a PDF

Most of what you want to check about a pipeline is routing — does the fallback fire, is the
error the right error, was the classifier consulted. None of that needs a PDF, and parsing
one makes the test slower and the failure less specific.

| Double | What it gives you |
|---|---|
| `loadedDocument(pages)` | a `LoadedDocument` from strings |
| `inMemoryLoader(document)` | a loader that returns it |
| `fixedStrategy(name, data)` | a strategy that always succeeds |
| `failingStrategy(name, msg)` | a strategy that always throws |

Two things the tests here document because they cost real debugging time:

- **`loadedDocument` synthesises geometry by default.** Pass `{ geometry: false }` for the
  text-only case. Otherwise a `GEOMETRY`-requiring strategy *is* eligible, runs, and you
  get `EXTRACTION_FAILED` where you expected `NO_ELIGIBLE_STRATEGY`.
- **`inMemoryLoader` ignores the bytes** and returns the document it was built with — but
  the source you pass still has to be a real `DocumentSource`. A bare `LoadedDocument` is
  not one; wrap it as `{ loaded: document }` or pass any placeholder bytes.

## Conformance is one call

```ts
describeLoaderConformance({ name: "MyLoader", create: () => new MyLoader() });
```

Your loader is now held to the invariants the built-in four are held to — coordinate
origin, line ordering, `form` reporting, empty-page handling, disposal. That is what makes
swapping libraries a *tested* guarantee rather than an interface coincidence.

## The one place a mock model belongs

A runnable example must not mock: you came to see what a model does, and a scripted answer
would teach you the wiring and lie about the result. A test is the opposite — you already
know what the model would say, and what you are checking is that your prompt assembly,
schema and usage plumbing are right.

`MockLanguageModelV4` from `ai/test` is the AI SDK's own double, so the strategy still
runs through the real `generateText with Output.object` path with only the network replaced. One trap the
tests here spell out: provider spec v4 nests `finishReason` and `usage`, and a flat `usage`
mock reports **zero tokens everywhere** — quietly.

## What to read next

[`15-cli`](../15-cli) — the same library from a terminal.
