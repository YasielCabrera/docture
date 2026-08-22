# @docture/loader-tesseract

`DocumentLoaderTesseract` is a docture `DocumentLoader` that reads a document by **recognizing its
pixels**, backed by [tesseract.js](https://github.com/naptha/tesseract.js) (Tesseract compiled
to WASM; no native binary, no system install).

```sh
pnpm add @docture/loader-tesseract
```

OCR needs pixels, so this loader needs a way to get them: a rasterizer for a PDF, or nothing
at all for an image that is already a PNG or JPEG.

```ts
import { createExtractor } from "@docture/core";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { DocumentLoaderTesseract } from "@docture/loader-tesseract";

const extractor = createExtractor({
  loaders: [
    new DocumentLoaderPdfJs(),        // PDFs: the text layer, when there is one
    new DocumentLoaderTesseract(),  // PNG/JPEG: recognize the pixels
  ],
  strategies: [/* … */],
});

await extractor.extract("receipt-photo.jpg", Receipt);
```

OCR is the slowest and least accurate way to read a document, roughly 0.5 to 1.5 s per page
against a text layer's fraction of a millisecond, and it *guesses* where a text layer *knows*.
Reach for it when there is no text layer to read.

## Wiring it next to a text-layer loader

Worth being precise about, because the obvious reading is wrong. The pipeline picks the first
loader that **accepts the media type** and does not throw. A text-layer loader does not throw
on a scan. It succeeds, reporting `form: "scanned"` and no text, so simply listing OCR after
it is **not** a fallback chain, and OCR never gets a turn.

Two wirings that do work:

**By media type.** The example above. The two loaders cover disjoint inputs, so each document
has exactly one candidate: PDFs to the text layer, photographs and scans-as-images to OCR.

**As a real fallback**, by making "no text layer" a thrown error, which *is* what hands the
document to the next loader:

```ts
import { createExtractor, defineLoader } from "@docture/core";
import { NapiCanvasRasterizer } from "@docture/raster-canvas";

const pdfjs = new DocumentLoaderPdfJs();
const textLayerOrBust = defineLoader({
  name: pdfjs.name,
  capabilities: pdfjs.capabilities,
  async load(document, ctx) {
    const loaded = await pdfjs.load(document, ctx);
    // A scan is not a failure for pdf.js. It is one for us.
    if (loaded.form === "scanned") throw new Error("pdfjs: no text layer to read");
    return loaded;
  },
});

const extractor = createExtractor({
  loaders: [
    textLayerOrBust,
    new DocumentLoaderTesseract({ rasterizer: new NapiCanvasRasterizer() }),
  ],
  strategies: [/* … */],
});
```

Now a digital PDF is read instantly and a scanned one is OCR'd, with no branching in your
code, and `result.loader` plus `result.attempts` say which happened and why.

## OCR or a vision model

Both turn a scan into structured data, and they are not rivals so much as different bets.

| | OCR (`DocumentLoaderTesseract`) | Vision (`vision({ model })`) |
|---|---|---|
| Cost | free after the download | per page, per token |
| Determinism | same bytes, same text | sampled |
| What it gives you | text **with positions and confidence** | fields, straight from an image |
| Handwriting, stamps, bad photos | poor | much better |
| Works offline | yes | no |

OCR also feeds everything downstream that expects text: a deterministic parser, a cheap
text-only model, a classifier. A scan becomes an ordinary document.

## Capabilities

`text: true`, `geometry: true`, `images: true`. It reads words with positions, and because it
necessarily has the pixels, `page.image()` works too, so a vision strategy can fall back to
looking at the page without any extra composition.

`mimeTypes` depends on how you built it. With no rasterizer there is no honest way to read a
PDF, so it is not advertised. The pipeline routes PDFs to another loader instead of choosing
this one and then failing:

```ts
new DocumentLoaderTesseract().capabilities.mimeTypes;
// ["image/png", "image/jpeg"]

new DocumentLoaderTesseract({ rasterizer }).capabilities.mimeTypes;
// ["image/png", "image/jpeg", "application/pdf"]
```

The rasterizer is a **constructor argument**, not something looked up at run time, so a
missing one is visible where the loader is built.

## Options

| Option | Default | |
|---|---|---|
| `rasterizer` | none | how pages become pixels, required for anything that is not already PNG/JPEG |
| `languages` | `["eng"]` | traineddata languages, e.g. `["eng", "deu"]`; ~5 MB each, downloaded once |
| `dpi` | `300` | render resolution for the OCR pass; below ~200 accuracy drops sharply |
| `maxPages` | all | cap recognition; useful for a cheap classification pass |
| `pageSegmentation` | `"auto"` | `"auto"`, `"singleColumn"`, `"singleBlock"`, `"singleLine"`, `"sparse"` |
| `minConfidence` | `0` | drop words below this confidence, 0 to 1 |
| `lineTolerance` | `0.5` | vertical band for grouping words into lines, as a fraction of median word height |
| `autoRotate` | `false` | detect and correct page skew first; worth it for photos and hand scans |
| `concurrency` | `1` | pages recognized at once; each lane is a worker thread with its own engine (~100 MB) |
| `langPath` | the CDN | directory or base URL to read `<lang>.traineddata` from |
| `cachePath` | `~/.cache/docture/tesseract` | where downloaded traineddata is cached |
| `parameters` | none | raw Tesseract variables, for example `{ tessedit_char_whitelist: "0123456789.," }` |

## Notes

- **Coordinates** are PDF points, top-left origin, y increasing downward, the same as every
  other loader. Pixel boxes are converted using the rasterizer's reported points-per-pixel, so
  a 300-DPI scan of an A4 page reports a 595×842 pt page.
- **Confidence** rides along: every `span` carries `confidence` from 0 to 1, which a text layer
  cannot offer. `result` metadata also reports `meanConfidence` for the pages read.
- **Line grouping** uses core's `linesFromWords` rather than Tesseract's own block structure.
  Two reasons: an OCR'd page and a text-layer page then group identically, so a parser written
  against one works on the other; and on a table Tesseract's layout analysis routinely puts the
  right-hand Amount column in its *own* block, which divorces a row's total from its
  description. Banding by `y` puts the row back together.
- **Page segmentation defaults to `"auto"`** (Tesseract's `--psm 3`) rather than tesseract.js's
  own default of `--psm 6`. At `--psm 6` layout analysis finds one uniform block and silently
  drops things like a page heading. There is a test for exactly that.
- **`maxPages` caps the OCR pass, not the render.** The `Rasterizer` contract exposes no page
  count to iterate against, so pages are rendered in one call and recognition is what gets
  limited. Recognition is the part that costs seconds per page.
- **An image input** has no intrinsic page size, so it is treated as a page scanned at `dpi`.
  `page.image()` then returns the bytes you passed in rather than re-encoding them.
- **The language model is downloaded on first use** (~5 MB from the jsdelivr CDN) and cached
  outside the working directory. To run fully offline, vendor the traineddata and point
  `langPath` at it:

  ```ts
  new DocumentLoaderTesseract({ rasterizer, langPath: "./tessdata", cachePath: "./tessdata" });
  ```

- **`dispose()`** terminates the worker threads. Call it, and call it once. It is idempotent,
  and a later `load()` simply starts a fresh engine.
- tesseract.js is loaded with `await import()` at first use, so constructing the loader is free
  and a pipeline that never OCRs a page pays nothing.

## Tests

The default run is offline and takes milliseconds. The conformance suite and the OCR specifics
need the real engine and the network on first use, so they are behind a flag:

```sh
pnpm test                 # offline: capabilities, refusals, image sizing
RUN_OCR=1 pnpm test       # + loader conformance and OCR behaviour, against real recognition
```

## License

MIT. tesseract.js and its models are Apache-2.0.
