# @docture/synthetic

Generate labeled synthetic documents from your extraction schema. Each document comes with ground truth that is correct by construction: the value of every printed field, and the page and box where it is printed. Corpora are reproducible from a seed, and `@docture/eval` can score them with no manual labeling.

## Install

```sh
npm install @docture/synthetic docture zod@^4 pdfkit@^0.20
# Label verification and corpora:
npm install pdfjs-dist@^6.2.108 @napi-rs/canvas@^1.0.10
# Scan, photo and fax renditions (also needs pdfjs-dist and @napi-rs/canvas):
npm install sharp@0.35.5
# Optional value and layout engines:
npm install @faker-js/faker@10.6.0   # @docture/synthetic/faker
npm install playwright-core@1.64.1   # @docture/synthetic/html, then: npx playwright-core install chromium
npm install ai@^7                    # @docture/synthetic/llm
```

## Quick start

```ts
import { defineModel, defineTemplate, gen, locales, sumOf, drawTable } from "@docture/synthetic";
import { renderPdf } from "@docture/synthetic/pdfkit";
import { z } from "zod";

const Receipt = z.object({
  store: z.string(),
  date: z.string(),
  items: z.array(z.object({ name: z.string(), cents: z.number().int() })),
  totalCents: z.number().int(),
});
type Receipt = z.infer<typeof Receipt>;

const model = defineModel(Receipt, {
  fields: {
    store: gen.pick(["Corner Market", "Blue Fern Café"]),
    date: gen.date({ from: "2025-01-01", to: "2025-12-31" }),
    items: gen.array({ length: [1, 8] }),
    "items[].cents": gen.int(99, 4_999),
  },
  derive: (value) => ({ ...value, totalCents: value.items.reduce((sum, item) => sum + item.cents, 0) }),
  constraints: [sumOf("items[].cents", "totalCents")],
});

const slip = defineTemplate<Receipt>()({
  key: "slip",
  family: "receipt",
  locale: locales["en-US"],
  page: { size: { width: 226, height: 600 }, margin: 12 },
  printed: { store: true, date: true, items: { items: { name: true, cents: true } }, totalCents: true },
  draw(page, value, f) {
    page.field("store", value.store, { x: 12, y: 12, font: "bold", size: 12 });
    page.field("date", f.date(value.date), { x: 12, y: 30, size: 8 });
    const y = drawTable(page, {
      path: "items", items: value.items, x: 12, y: 50, bottom: 560, continueAt: 12, style: { size: 8 },
      columns: [
        { header: "Item", width: 140, key: "name", text: (item) => item.name },
        { header: "", width: 62, key: "cents", align: "right", text: (item) => f.money(item.cents) },
      ],
    });
    page.field("totalCents", f.money(value.totalCents), { x: 214, y: y + 8, align: "right", font: "bold" });
  },
});

const document = await renderPdf(slip, await model.sample({ seed: 1 }));
document.labels; // [{ path: "store", value: "…", text: "…", pageNumber: 1, box: { x, y, width, height } }, …]
```

A template must declare every schema field in `printed`, so a new field fails to compile until each template decides whether it prints it. `false` makes the field's ground truth `null`; `prints((value) => label)` makes it what the page shows, such as a plan name that two tariffs share. A field drawn without a declaration, or declared and never drawn, fails the render with `TemplateError`.

## Verify, degrade and write a corpus

```ts
import { assertVerified } from "@docture/synthetic/verify";
import { digital, photo, scan, writeCorpus } from "@docture/synthetic/node";

await assertVerified(document); // every label's text is inside its box on the PDF text layer

const report = await writeCorpus("corpus", {
  model,
  templates: [slip],
  seeds: [1, 2, 3],
  renditions: [digital(), scan({ severity: 0.3 }), photo({ severity: 0.6 })],
  createdAt: "2025-01-01T00:00:00Z",
});
```

`writeCorpus` renders each seed, scenario and template once, verifies it, and derives each rendition from that rendering. Scans and photos warp each page by one homography and move every label box through the same matrix. The corpus holds one folder per case plus `manifest.jsonl`, which `@docture/eval`'s `jsonlDataset` reads with tags for `template`, `scenario`, `rendition` and `severity`, a `group` per rendering, and `locations` for grounding. A rerun skips every case whose inputs and files are unchanged. The case key hashes the source text of template and scenario functions, not the values they read from outside, so change `createdAt` after editing a constant or an asset a template reads.

`degrade(document, { output: "png" })` or `"jpeg"` returns one page as an image and writes its `dpi` into the image metadata. Its label boxes stay in PDF points, so read the image at the same dpi, for example with the Tesseract loader's `dpi: document.rendition.dpi`.

`docture synth list|gen|render|corpus|verify` in `@docture/cli` runs the same steps from a `docture.synth.ts` file typed with `defineSynthConfig`.

## Fonts

Templates draw with the standard PDF fonts (Helvetica and Courier) unless they declare their own. Those cover Western European text, `€` and `£`, but not, for example, `ł` or U+2212. Pass TrueType or OpenType bytes in `fonts` for other scripts. The renderer checks every drawn character against its font and fails with `TemplateError` (`missing-glyph`) instead of printing a wrong character.

## Errors

Each error extends `DoctureError` and carries a literal `code`:

- `SynthesisError`, code `SYNTHESIS_FAILED`: a sample breaks the schema, a constraint or its scenario's promise.
- `TemplateError`, code `TEMPLATE_INVALID`: the drawing and the printed mask disagree, or a font lacks a glyph.
- `LabelVerificationError`, code `LABEL_VERIFICATION_FAILED`: a labeled value is not inside its box on the rendered page.

See the [synthetic corpus guide](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/synthetic/quick-start.mdx), the [API reference](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/synthetic/reference.mdx) and [example 24](https://github.com/YasielCabrera/docture/tree/main/apps/examples/24-synthetic-corpus).

## Entries

| Entry | Purpose | Engines |
|---|---|---|
| `@docture/synthetic` | Models, generators, constraints, scenarios, printed masks, templates, tables, formatting, `toEvalCase` | none |
| `@docture/synthetic/pdfkit` | Render templates to PDF with field boxes | `pdfkit` |
| `@docture/synthetic/verify` | Read a PDF back and confirm every label | `pdfjs-dist` |
| `@docture/synthetic/measure` | Measure text lines in a PDF and how far a template's text drifts from a reference PDF | `pdfjs-dist` |
| `@docture/synthetic/degrade` | Scan, low-quality scan, photo and fax renditions with transformed boxes | `sharp`, `pdfjs-dist`, `@napi-rs/canvas`, `pdfkit` |
| `@docture/synthetic/node` | Write a resumable corpus that `@docture/eval`'s `jsonlDataset` reads | the engines of the renditions you ask for |
| `@docture/synthetic/faker` | Seeded, locale-aware values from Faker | `@faker-js/faker` |
| `@docture/synthetic/html` | HTML and CSS templates printed by Chromium | `playwright-core` |
| `@docture/synthetic/llm` | Model-written text pools, cached for offline rebuilds | `ai` |

Engines are optional peers. An entry whose engine is missing throws `MissingEngineError` naming the package and range to install.
