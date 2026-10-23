# 03-loaders-and-sources — Loaders and sources

> pdf.js vs MuPDF, `DocumentLoaderData` on real text, every `DocumentSource`, `DocumentFeatures`, the `pages` option, the two load failures.

**Needs:** `pnpm run fetch`. No API key. Fetches one document over the network to show the URL case.

```sh
pnpm --filter @docture/examples loaders
```

Docs: [`concepts/loaders`](../../docs/content/docs/concepts/loaders.mdx)

## Imports and installs

Import `DocumentLoaderPdfJs` from `docture/loaders/pdfjs` and
`DocumentLoaderMuPdf` from `docture/loaders/mupdf`. `DocumentLoaderData` comes from
`docture` and needs no engine.

For a separate application:

```sh
pnpm add docture pdfjs-dist@6.2.108 mupdf@1.28.0 zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

Which library reads your document is a real decision, so it is a real import:
`DocumentLoaderPdfJs` or `DocumentLoaderMuPdf`. Both produce the same shape, and this
example runs the same invoice through both.

`DocumentLoaderData` is the one loader that lives in core, because it wraps no library —
plain text, Markdown, CSV, JSON and HTML are bytes plus `TextDecoder`. It reads
`invoice-orlen`, which is a real invoice from the same corpus that ships as `.txt`.

## A gotcha this example does not hide

Every `DocumentSource` resolves to `application/pdf` except the `https:` URL, which
resolves to `application/octet-stream`. That is not a bug — for an http source the
server's `content-type` header *is* what the caller said, and
`raw.githubusercontent.com` serves everything as octet-stream.

A server that mislabels is a real problem. The fix is to say so yourself: pass a
`RawDocument` with an explicit `mimeType`, and nothing has to guess.

## `pages`, demonstrated rather than asserted

```
run                     pages the strategy saw       chars  saw credit line
no `pages` option       1, 2, 3, 4, 5, 6            13,503  true
pages: [1, 2, 3]        1, 2, 3                      4,117  false
```

The file is read once either way. `pages` filters what the **strategy** is handed; it does
not re-parse. That is the same mechanism `Process` uses in example 11.

## What to read next

[`04-capabilities-and-composition`](../04-capabilities-and-composition) — the wiring
mistake that is a compile error.
