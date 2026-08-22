# @docture/loader-mupdf

`DocumentLoaderMuPdf` and `MuPdfRasterizer` are a docture `DocumentLoader` and `Rasterizer`, both backed
by [MuPDF](https://mupdf.readthedocs.io/) compiled to WASM.

```sh
pnpm add @docture/loader-mupdf
```

```ts
import { createExtractor, withRasterizer } from "@docture/core";
import { DocumentLoaderMuPdf, MuPdfRasterizer } from "@docture/loader-mupdf";

const extractor = createExtractor({
  loaders: [withRasterizer(new DocumentLoaderMuPdf(), new MuPdfRasterizer({ dpi: 300 }))],
  strategies: [/* … */],
});
```

## Two plugins, one package

Reading and rendering are separate plugins here as everywhere else in this repo, so
`DocumentLoaderMuPdf` can be rendered by `NapiCanvasRasterizer`, and `MuPdfRasterizer` can render for
a `DocumentLoaderTesseract`. Neither choice forces the other.

They ship together because they are **one dependency**: `mupdf` instantiates a single WASM
engine that both classes share. Splitting them across two packages would mean two copies of a
multi-megabyte WASM binary to read and render the same file.

| Class | Capabilities |
|---|---|
| `DocumentLoaderMuPdf` | `text: true`, `geometry: true`, `images: false` |
| `MuPdfRasterizer` | `png`, `jpeg` |

Composed, `loader.name` is `"mupdf+mupdf"`. Reader first, renderer second, the same way
`"pdfjs+napi-canvas"` reads.

## Why MuPDF rather than pdf.js

- **No native binary and no prebuilt to match to your platform.** Rendering happens inside
  WASM and MuPDF encodes the PNG or JPEG itself, so there is no `@napi-rs/canvas` (or `sharp`,
  or a build step) in the tree.
- **One dependency for both jobs.** Text, geometry and rendering come from the same install.
- It is fast, and there is no worker to spin up.

What you give up: MuPDF's WASM calls are **synchronous and blocking**, so a large document
occupies the event loop while it is read. pdf.js does its work in a worker. For a server
handling concurrent requests that difference is worth weighing.
[`@docture/loader-pdfjs`](../loader-pdfjs) is the same contract if you would rather not block.

## Options

`DocumentLoaderMuPdf`:

| Option | Default | |
|---|---|---|
| `password` | none | for an encrypted PDF |
| `maxPages` | all | stop early; useful for a cheap classification pass |
| `lineTolerance` | `0.5` | vertical band for grouping runs into lines, as a fraction of median run height |

`MuPdfRasterizer`:

| Option | Default | |
|---|---|---|
| `dpi` | `300` | render resolution |
| `format` | `"png"` | `"png"` or `"jpeg"` |
| `quality` | `0.9` | JPEG quality from 0 to 1, ignored for PNG |
| `maxEdge` | none | cap the long edge in pixels, downscaling if needed |
| `password` | none | for an encrypted PDF |
| `annotations` | `true` | render annotations and form-field appearances |

Both take per-call `RasterOptions` too, which win over the constructor's.

## Notes

- **Coordinates** are PDF points, top-left origin, y increasing downward, which is what MuPDF
  reports natively, so nothing here flips an axis. MuPDF also normalizes a page's origin to
  `(0, 0)`, so a CropBox starting at `(20, 30)` needs no offset either.
- **MuPDF's lines are text runs, not visual rows.** An invoice row's four cells arrive as four
  separate "lines", so words are regrouped with `linesFromWords`, the same helper every other
  geometry loader here uses. A table parser written against `DocumentLoaderPdfJs` reads this one
  unchanged.
- **A scanned PDF** yields `form: "scanned"` and empty text rather than nonsense, so a
  text-layer strategy is simply not eligible for it.
- **MuPDF's own diagnostics go to your logger.** MuPDF reports through a global hook that
  defaults to stderr, so a repairable PDF would otherwise print `trying to repair broken xref`
  regardless of what you configured. The hook is bridged to `ctx.logger`, which means
  `silentLogger` really is silent.
- **Rendering is on a white background** (`alpha: false`), because a transparent-black page is
  something JPEG cannot carry and a vision model reads as inverted.
- `mupdf` is loaded with `await import()` at first use, so constructing either class is free.
  it runs a top-level `await` to instantiate its WASM module, and a static import would make
  merely naming `DocumentLoaderMuPdf` cost the whole engine.

## Licensing

**`mupdf` is AGPL-3.0-or-later.** The adapter code in this package is MIT, but installing it
pulls MuPDF, and distributing software that links MuPDF puts you under the AGPL unless you hold
a commercial licence from [Artifex](https://artifex.com/licensing/). This is why loaders are
one-package-per-library: nothing here is pulled unless you ask for it, and
[`@docture/loader-pdfjs`](../loader-pdfjs) (Apache-2.0) is the permissive alternative behind the
same contract.
