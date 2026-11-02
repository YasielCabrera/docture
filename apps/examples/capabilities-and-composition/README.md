# Render a page alongside its text

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Compose the PDF.js loader with a canvas rasterizer using `withRasterizer()`. The strategy asks for geometry and renderable pages, then reads the first page image.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples capabilities
```

The script saves `output/page-1.png` and prints its dimensions and the number of positioned text lines.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist @napi-rs/canvas
```

The sample PDF is bundled beside the code. [Original document](https://filedone.ai/sample-files/sample-invoice.pdf).
