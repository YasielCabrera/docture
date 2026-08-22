# @docture/loader-pdfjs

`DocumentLoaderPdfJs` is a docture `DocumentLoader` backed by
[pdfjs-dist](https://github.com/mozilla/pdf.js) (Mozilla PDF.js).

```sh
pnpm add @docture/loader-pdfjs
```

```ts
import { createExtractor } from "@docture/core";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";

const extractor = createExtractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [/* … */],
});
```

## Capabilities

`text: true`, `geometry: true`, `images: false`. It reads, it does not render. For rendering,
compose it with a rasterizer:

```ts
import { withRasterizer } from "@docture/core";
import { NapiCanvasRasterizer } from "@docture/raster-canvas";

withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer({ dpi: 300 }));
```

## Options

| Option | Default | |
|---|---|---|
| `password` | none | for an encrypted PDF |
| `maxPages` | all | stop early; useful for a cheap classification pass |
| `lineTolerance` | `0.5` | vertical band for grouping runs into lines, as a fraction of median run height |

## Notes

- **Coordinates** are PDF points, top-left origin, y increasing downward. `lines` is sorted
  top-to-bottom, spans left-to-right.
- **A scanned PDF** yields `form: "scanned"` and empty text rather than nonsense, so a
  text-layer strategy is simply not eligible for it.
- pdf.js needs its **legacy build** in Node and a **filesystem path** (not a `file://` URL) for
  its standard fonts. Both are handled here so you never see either failure.
  [`src/pdfjs.ts`](./src/pdfjs.ts) explains why.
- pdf.js is loaded with `await import()` at first use, so constructing the loader is free.
