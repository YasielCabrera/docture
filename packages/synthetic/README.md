# @docture/synthetic

Generate labeled synthetic documents from your extraction schema. Each document comes with ground truth that is correct by construction: the value of every printed field, and the page and box where it is printed. Corpora are reproducible from a seed, and `@docture/eval` can score them with no manual labeling.

## Install

```sh
npm install @docture/synthetic docture zod pdfkit
# Label verification and corpora:
npm install pdfjs-dist @napi-rs/canvas
# Scan, photo and fax renditions (also needs pdfjs-dist and @napi-rs/canvas):
npm install sharp
# Optional value and layout engines:
npm install @faker-js/faker   # @docture/synthetic/faker
npm install react @react-pdf/renderer   # @docture/synthetic/react-pdf
npm install playwright-core   # @docture/synthetic/html, then: npx playwright-core install chromium
npm install ai                    # @docture/synthetic/llm
```

The supported Faker version is `10.6.0`. Pin that version in the consuming project's development dependencies.

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

## Generate fields and related records

Your schema chooses the fields in a document. Use `gen.pattern` for identifiers, `gen.pick` for known values, and `fakerFor` for names. Related fields can read one another through `gen.from`, `get`, and `sibling`.

`gen.iban({ country, bban })` generates one IBAN string from a supplied BBAN generator. The country can be a string or another generator. For example, a model can generate its own routing and account fields, then derive an IBAN:

```ts
const fields = {
  routingCode: gen.pattern("########"),
  accountNumber: gen.pattern("##########"),
  iban: gen.iban({
    country: "DE",
    bban: gen.from((context) =>
      context.get<string>("routingCode") + context.get<string>("accountNumber")),
  }),
};
```

The caller owns the national BBAN format and any bank metadata. Other documents can choose different fields. Existing `gen.iban(country?)` calls retain their random numeric BBAN behavior. Checksum validity does not establish that an account exists.

`valuePool` validates records from a named offline source or a cache. Use it for inventory items, appointments, customer profiles, or another JSON data model, then sample its array with `gen.pick(pool)`. Each pool requires a runtime-validating Standard Schema with input JSON Schema output, a `revision`, and an exact `count`. Cache hits undergo the same validation as newly generated values. The returned JSON-safe outputs are copied and deep-frozen, including schema defaults and transformations. Faker generators select their locale explicitly, including `ja`, `en_US`, and `de`; pools impose no country or industry rules.

`llmObjectPool` from `@docture/synthetic/llm` uses that same boundary for structured provider replies. Its `source` is either `{ kind: "model", model }` or `{ kind: "cache-only", model: "provider/model-id" }`. Cache-only mode requires a cache and never loads AI. A missing or corrupt offline entry fails instead of calling a provider. Cache raw input records so transformations run once per read. Change `revision` when refinements or transforms change outside the JSON Schema. See the [pool reference](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/synthetic/reference/text-generators.mdx).

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

`writeCorpus` renders each seed, scenario and template once, verifies it, and derives each rendition from that rendering. Scans and photos warp each page by one homography and move every label box through the same matrix. The corpus holds one folder per case plus `manifest.jsonl`, which `@docture/eval`'s `jsonlDataset` reads with tags for `template`, `scenario`, `rendition` and `severity`, a `group` per rendering, and `locations` for grounding. A rerun skips every case whose inputs and files are unchanged.

Declare captured inputs in `dependencies` on `defineModel` or `writeCorpus`. The same field is available in `defineSynthConfig`. Dependencies accept JSON data and `Uint8Array` bytes, such as bank catalogues, pool contents, helper revisions, logos, and renderer pins. The writer hashes those values before writing, ignores record key order, and records digests in `corpus.json`. Changed inputs rewrite the same case IDs. Corpus evidence also records installed peer versions, including Faker and AI, without loading those engines. Function source fingerprints cannot inspect closures, so undeclared external values still need an explicit revision or a fresh corpus directory.

`degrade(document, { output: "png" })` or `"jpeg"` returns one page as an image and writes its `dpi` into the image metadata. Its label boxes stay in PDF points, so read the image at the same dpi, for example with the Tesseract loader's `dpi: document.rendition.dpi`.

`docture synth list|gen|render|corpus|verify` in `@docture/cli` runs the same steps from a `docture.synth.ts` file typed with `defineSynthConfig`.

## React templates

`@docture/synthetic/react-pdf` renders templates written as React components with `@react-pdf/renderer`. Wrap each printed value in `<Field path>`; its label box comes from react-pdf's layout, so pages can use flexbox, components, automatic page wrapping and repeating headers:

```tsx
import { Page, Text } from "@react-pdf/renderer";
import { defineReactTemplate } from "@docture/synthetic/react-pdf";

const react = defineReactTemplate<Invoice>()({
  key: "react",
  family: "invoice",
  locale: locales["de-DE"],
  printed: { invoiceNumber: true /* ... */ },
  render: ({ value, format, Field }) => (
    <Page size="A4" style={{ padding: 50 }}>
      <Text>RECHNUNG</Text>
      <Field path="invoiceNumber">{value.invoiceNumber}</Field>
    </Page>
  ),
});
const document = await react.renderDocument(await model.sample({ seed: 7 }));
```

React templates work in `writeCorpus` and `docture synth` beside PDFKit templates. See the [React template guide](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/synthetic/react-templates.mdx).

## Fonts

Templates draw with the standard PDF fonts (Helvetica and Courier) unless they declare their own. Those cover Western European text, `€` and `£`, but not, for example, `ł` or U+2212. Pass TrueType or OpenType bytes in `fonts` for other scripts. The renderer checks every drawn character against its font and fails with `TemplateError` (`missing-glyph`) instead of printing a wrong character.

## Errors

Each error extends `DoctureError` and carries a literal `code`:

- `SynthesisError`, code `SYNTHESIS_FAILED`: a sample breaks its rules, or a structured pool fails schema validation, distinctness, count, or cache requirements.
- `TemplateError`, code `TEMPLATE_INVALID`: the drawing and the printed mask disagree, or a font lacks a glyph.
- `LabelVerificationError`, code `LABEL_VERIFICATION_FAILED`: a labeled value is not inside its box on the rendered page.

See the [synthetic corpus guide](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/synthetic/quick-start.mdx), the [API reference](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/synthetic/reference/index.mdx) and [synthetic corpus example](https://github.com/YasielCabrera/docture/tree/main/apps/examples/synthetic-corpus).

## Entries

| Entry | Purpose | Engines |
|---|---|---|
| `@docture/synthetic` | Models, generators, validated value pools, constraints, scenarios, printed masks, templates, tables, formatting, `toEvalCase` | none |
| `@docture/synthetic/pdfkit` | Render templates to PDF with field boxes | `pdfkit` |
| `@docture/synthetic/verify` | Read a PDF back and confirm every label | `pdfjs-dist` |
| `@docture/synthetic/measure` | Measure text lines in a PDF and how far a template's text drifts from a reference PDF | `pdfjs-dist` |
| `@docture/synthetic/degrade` | Scan, low-quality scan, photo and fax renditions with transformed boxes | `sharp`, `pdfjs-dist`, `@napi-rs/canvas`, `pdfkit` |
| `@docture/synthetic/node` | Write a resumable corpus that `@docture/eval`'s `jsonlDataset` reads | the engines of the renditions you ask for |
| `@docture/synthetic/faker` | Seeded, locale-aware values from Faker | `@faker-js/faker` |
| `@docture/synthetic/react-pdf` | React templates laid out by react-pdf, with a box for every `<Field>` | `react`, `@react-pdf/renderer` |
| `@docture/synthetic/html` | HTML and CSS templates printed by Chromium | `playwright-core` |
| `@docture/synthetic/llm` | Model-written text and structured pools, cached for offline rebuilds | `ai` for generation |

Engines are optional peers. An entry whose engine is missing throws `MissingEngineError` naming the package and range to install.
