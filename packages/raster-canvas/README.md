# @docture/raster-canvas

`NapiCanvasRasterizer` renders PDF pages to PNG or JPEG, using
[pdfjs-dist](https://github.com/mozilla/pdf.js) to draw onto a
[@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) surface.

```sh
pnpm add @docture/raster-canvas
```

```ts
import { withRasterizer } from "@docture/core";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { NapiCanvasRasterizer } from "@docture/raster-canvas";

// A loader that both reads text AND renders pages. The type says so.
const loader = withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer({ dpi: 300 }));
```

Rendering is its own plugin type so that "which library renders pages" and "which library reads
them" stay independent decisions. A MuPDF renderer can feed a tesseract.js OCR pass.

## Options

Set defaults on the constructor; override per call.

| Option | Default | |
|---|---|---|
| `dpi` | `300` | 300 for OCR, ~200 is plenty for a vision model |
| `format` | `"png"` | `"png"` or `"jpeg"` |
| `quality` | `0.9` | JPEG only, 0 to 1 |
| `maxEdge` | none | cap the long edge in pixels, and it wins over `dpi` when they conflict |
| `pages` | all | 1-based page numbers |

`RasterPage.scale` is points per pixel, computed from what the rasterizer actually produced,
so it stays
correct after a `maxEdge` downscale, and pixel boxes can be mapped back to PDF points.

Both libraries load lazily at first render, so constructing the rasterizer is free.
