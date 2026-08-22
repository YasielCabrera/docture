# @docture/loader-paddleocr

`DocumentLoaderPaddleOcr` is a docture `DocumentLoader` that reads a document by **recognizing its
pixels**, backed by [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)'s ONNX models via
[ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr). No native build
step: `onnxruntime-node` ships prebuilt bindings.

```sh
pnpm add @docture/loader-paddleocr
```

OCR needs pixels, so this loader needs a way to get them: a rasterizer for a PDF, or nothing
at all for an image that is already a PNG or JPEG.

```ts
import { createExtractor } from "@docture/core";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { DocumentLoaderPaddleOcr } from "@docture/loader-paddleocr";

const extractor = createExtractor({
  loaders: [
    new DocumentLoaderPdfJs(),      // PDFs: the text layer, when there is one
    new DocumentLoaderPaddleOcr(),  // PNG/JPEG: recognize the pixels
  ],
  strategies: [/* … */],
});

await extractor.extract("receipt-photo.jpg", Receipt);
```

OCR is the slowest and least accurate way to read a document. It *guesses* where a text layer
*knows*. Reach for it when there is no text layer to read.

## PaddleOCR or Tesseract

Both packages read pixels and report the same shape, and both pass the same conformance suite,
so this is a real choice rather than a migration. Swapping is an import.

| | `DocumentLoaderPaddleOcr` | `DocumentLoaderTesseract` |
|---|---|---|
| How | two neural nets: detect regions, then recognize them | a line recognizer behind a layout analyser |
| Geometry | a box per **detected region**, so coarser | a box per **word** |
| Photos, rotation, low contrast | better | poor |
| Non-Latin scripts | a model per script, incl. Arabic, Thai, Devanagari, Korean | traineddata per language |
| Runtime | `onnxruntime-node` (prebuilt native binding) | pure WASM |
| First-run download | ~6.5 MB (default model) | ~5 MB per language |
| Confidence | per region | per word |

Neither is a subset of the other. If the documents matter, run both through
[`@docture/eval`](../eval) and let the score decide.

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
    new DocumentLoaderPaddleOcr({ rasterizer: new NapiCanvasRasterizer() }),
  ],
  strategies: [/* … */],
});
```

Now a digital PDF is read instantly and a scanned one is OCR'd, with no branching in your
code, and `result.loader` plus `result.attempts` say which happened and why.

## Capabilities

`text: true`, `geometry: true`, `images: true`. It reads text with positions, and because it
necessarily has the pixels, `page.image()` works too, so a vision strategy can fall back to
looking at the page without any extra composition.

`mimeTypes` depends on how you built it. With no rasterizer there is no honest way to read a
PDF, so it is not advertised. The pipeline routes PDFs to another loader instead of choosing
this one and then failing:

```ts
new DocumentLoaderPaddleOcr().capabilities.mimeTypes;
// ["image/png", "image/jpeg"]

new DocumentLoaderPaddleOcr({ rasterizer }).capabilities.mimeTypes;
// ["image/png", "image/jpeg", "application/pdf"]
```

The rasterizer is a **constructor argument**, not something looked up at run time, so a
missing one is visible where the loader is built.

## Options

| Option | Default | |
|---|---|---|
| `rasterizer` | none | how pages become pixels, required for anything that is not already PNG/JPEG |
| `model` | `"v6Tiny"` | a preset name, or the three files spelled out, see [Models](#models) |
| `dpi` | `300` | render resolution for the OCR pass; below ~200 accuracy drops sharply |
| `maxPages` | all | cap recognition; useful for a cheap classification pass |
| `minConfidence` | `0.5` | drop regions below this confidence, 0 to 1. PaddleOCR's `drop_score` |
| `strategy` | `"perLine"` | `"perBox"`, `"perLine"`, `"crossLine"`, how regions are batched for inference |
| `maxSideLength` | `"auto"` | longest side in pixels the **detector** sees; `clamp(0.75 × longest, 960, 1920)` |
| `paddingVertical` | `0.4` | padding around each region before it is read, as a fraction of its height |
| `paddingHorizontal` | `0.6` | as above, horizontally |
| `lineTolerance` | derived | vertical band for grouping regions into lines, see [Line grouping](#line-grouping) |
| `concurrency` | `"auto"` | pages recognized at once; 4 on CPU, 1 on an accelerator |
| `imageEngine` | `"openCv"` | `"openCv"` or `"canvas"`, where detection preprocessing happens |
| `executionProviders` | `["cpu"]` | ONNX execution providers, e.g. `["coreml", "cpu"]` |

## Models

PaddleOCR ships a recognizer per **script** rather than per language, so a model name is where
a non-Latin document is accommodated:

```ts
new DocumentLoaderPaddleOcr({ rasterizer, model: "v5Cyrillic" });
new DocumentLoaderPaddleOcr({ rasterizer, model: "v6Medium" });   // most accurate on offer
```

`PADDLE_MODELS` lists every preset: the PP-OCRv6 family (`v6Tiny`, `v6Small`, `v6Medium`), the
v5 English and multilingual models, per-script v5 models (`v5Arabic`, `v5Cyrillic`,
`v5Devanagari`, `v5Greek`, `v5EastSlavic`, `v5Korean`, `v5Latin`, `v5Tamil`, `v5Telugu`,
`v5Thai`), the v4 family including `v4ServerDocument`, and `v3Japanese`.

To run **fully offline**, or to run a model the catalogue does not list, name the three files
yourself: a path, a URL, or the bytes.

```ts
new DocumentLoaderPaddleOcr({
  rasterizer,
  model: {
    detection: "./models/PP-OCRv6_tiny_det.ort",
    recognition: "./models/PP-OCRv6_tiny_rec.ort",
    charactersDictionary: "./models/ppocrv6_tiny_dict.txt",
  },
});
```

## Notes

- **Coordinates** are PDF points, top-left origin, y increasing downward, the same as every
  other loader. Pixel boxes are converted using the rasterizer's reported points-per-pixel, so
  a 300-DPI scan of an A4 page reports a 595×842 pt page.
- **Boxes are regions, not words**, and they are **padded**: PaddleOCR expands each detected
  region by `paddingVertical`/`paddingHorizontal` × its own height before reading it, and
  reports the padded box. So a span here is looser than a word box from a text layer or from
  Tesseract. Two adjacent columns can overlap horizontally, which matters if you slice a table
  by x-ranges.
- <a id="line-grouping"></a>**Line grouping** uses core's `linesFromWords` rather than
  PaddleOCR's own, for two reasons. An OCR'd page and a text-layer page then group identically,
  so a parser written against one works on the other. And PaddleOCR's grouper compares the
  *top edges* of consecutive regions against half the *running average* height of the line so
  far. Both misjudge a row of mixed sizes, since a 20pt heading beside 10pt text has a top
  edge far enough above it to start a new line, and a tall region that does join a line widens
  the threshold for whatever comes next. core's bands on vertical centres against the page's
  median height.
- **`lineTolerance` is derived from `paddingVertical`**, not taken from core's 0.5. A reported
  box is `1 + 2 × paddingVertical` times the height of the text in it, so 0.5 would band at 0.9
  of a line, nearly twice as loose as every other loader on a document where nothing about the
  text changed. Dividing by the same factor makes the band proportional to the text: 0.28 at
  the default padding. On ordinary leading both group identically; the difference is the margin
  before a tight table starts merging rows.
- **`minConfidence` defaults to 0.5**, where `DocumentLoaderTesseract` defaults to 0. Not an
  inconsistency: a detect-then-recognize model reports a *confident* reading of whatever the
  detector handed it, so hatch patterns, logos and barcodes come back as plausible text at
  0.2 to 0.45. This is upstream PaddleOCR's own `drop_score`. Lower it to see everything the
  detector found.
- **`maxSideLength` is a detection cap, not a reading resolution.** The detector works on a
  downscaled copy; the recognizer always crops from the full-resolution image. Raise it if
  small print goes missing, and note that `"auto"` already scales with the input.
- **`maxPages` caps the OCR pass, not the render.** The `Rasterizer` contract exposes no page
  count to iterate against, so pages are rendered in one call and recognition is what gets
  limited. Recognition is the part that costs seconds per page.
- **An image input** has no intrinsic page size, so it is treated as a page scanned at `dpi`.
  `page.image()` then returns the bytes you passed in rather than re-encoding them.
- **The models are downloaded on first use** (~6.5 MB for the default) and cached in
  `~/.cache/ppu-paddle-ocr`. That path is ppu-paddle-ocr's and is not configurable. It does
  not honour `XDG_CACHE_HOME`, and the first download prints a line to stdout that the library
  does not gate behind a verbosity flag. Point `model` at local files to avoid both.
- **ppu-paddle-ocr's result cache is bypassed.** It memoizes recognition in a process-global
  LRU keyed on a 32-bit hash of an image's *first 1024 bytes* plus its length. Two pages of one
  scan share a PNG header, so a collision would serve one page another page's text, silently.
  The key also omits every option that changes the answer. This loader passes `noCache` on
  every call.
- **`dispose()`** releases both ONNX sessions. Call it, and call it once. It is idempotent,
  and a later `load()` simply builds a fresh engine.
- ppu-paddle-ocr is loaded with `await import()` at first use, so constructing the loader is
  free and a pipeline that never OCRs a page never loads the ONNX runtime.

## Tests

The default run is offline and takes milliseconds. The conformance suite and the OCR specifics
need the real engine and the network on first use, so they are behind a flag:

```sh
pnpm test                 # offline: capabilities, refusals, byte handling, the band
RUN_OCR=1 pnpm test       # + loader conformance and OCR behaviour, against real recognition
```

## License

MIT. ppu-paddle-ocr is MIT; PaddleOCR and its models are Apache-2.0; `onnxruntime-node` is MIT.
