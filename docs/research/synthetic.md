# Synthetic document renderer bake-off

Measured on 2026-10-28 for `@docture/synthetic`. The question is which engine renders a synthetic document and also yields each field's page and box in PDF points, top-left origin, y down. PDFKit stays the default. Every number below is measured on one machine unless a sentence labels it otherwise.

## Setup

The fixture is one A4 invoice. It has a header, two parties, 30 line items at 24 pt per row, and four totals rows. The table spans two pages in every engine. The buyer is `Kőváry Kft.` at `Fő utca 5`, and the discount is `−50.00` with U+2212. The ground-truth keys are 69 fields: title, number, date, two party names, 30 descriptions, 30 amounts, subtotal, discount, tax and total.

| Item | Version |
| --- | --- |
| Machine | Apple M4 Max, 36 GiB, Darwin 25.6.0, Node 24.14.0 |
| `pdfkit` | 0.20.2 |
| `playwright-core` | 1.64.1, Chromium headless shell 156.0.8078.4 (revision 1248) |
| `@react-pdf/renderer` | 4.9.0, which depends on upstream `pdfkit` 0.20.1 |
| `@myriaddreamin/typst-ts-node-compiler` | 0.7.0 with the `darwin-arm64` binary |
| `pdfjs-dist` | 6.4.299, used only to read the text layer |
| Embedded TTF | `/System/Library/Fonts/Supplemental/Arial.ttf` and `Arial Bold.ttf` |

PDFKit and Playwright paginate by hand at 22 rows on page 1. React-pdf and Typst paginate the table themselves.

### Reproduce

The scripts are throwaway files in `/tmp/synthetic-bakeoff/`. They are not in the repository.

```sh
cd /tmp/synthetic-bakeoff
for e in pdfkit playwright react-pdf typst pdfjs; do mkdir -p eng-$e; (cd eng-$e && npm init -y >/dev/null); done
(cd eng-pdfkit && npm i pdfkit@0.20.2)
(cd eng-playwright && npm i playwright-core@1.64.1)
(cd eng-react-pdf && npm i @react-pdf/renderer@4.9.0 react)
(cd eng-typst && npm i @myriaddreamin/typst-ts-node-compiler@0.7.0)
(cd eng-pdfjs && npm i pdfjs-dist@6.4.299)
./suite.sh   # determinism pairs, total-box deltas, benchmarks, 69-field check, glyph test
```

`render-<engine>.mjs` returns `{ buffer, boxes }`. `run.mjs` writes one PDF and compares the total box with the text layer. `bench.mjs` times renders. `check-all.mjs` checks all 69 boxes. `glyphs.mjs` runs the font test. `pin-dates.mjs` holds the Chromium date rewrite.

## 1. Box recovery

The check reads the PDF text layer with `pdfjs-dist` `getTextContent()`. For each item it takes `x0 = transform[4]`, `x1 = x0 + width` and `baseline = pageHeight - transform[5]`. The engine box gives left, right and baseline in the same top-left space. The table reports the delta for `EUR 8,701.86` on page 2 and the worst delta over all 69 fields with the embedded TTF.

| Engine | How the box is recovered | Total box delta left / right / baseline, pt | Worst over 69 fields, pt | Page correct |
| --- | --- | --- | --- | --- |
| PDFKit | Known at draw time. `x`, `y`, `widthOfString()`, `currentLineHeight()`, baseline `y + ascender / 1000 * size` | 0 / 0 / 0 | 0 | 69 of 69 |
| Playwright | `Range.getBoundingClientRect()` for ink width, a zero-size `inline-block` probe for the baseline, px to pt at 72/96, page from the enclosing fixed-size `.page` container | 0 / 0.006 / 0.246 | 0.27 | 69 of 69 |
| react-pdf | Internal layout tree from `Document onRender` (`_INTERNAL__LAYOUT__DATA_`). Sum ancestor `box.left/top`, add `paddingLeft`, subtract `alignOffset`, add `line.box.x`. Baseline is `top + paddingTop + line.ascent` | 0 / 0 / 0 | 0 | 69 of 69 |
| Typst | `box({ context { here().position(); measure(body) } ; body })` emits `metadata` labelled `<box>`, read with `compiler.query(doc, { selector: '<box>', field: 'value' })`. Baseline is `y + measure(body).height` | 0 / 0 / 0 | 0 | 69 of 69 |

Observations behind the numbers:

- The Playwright baseline gap measured 0.15 to 0.27 pt across runs and fields. The text-layer baseline of the total landed on a whole CSS pixel, 384 px. The likely cause, inferred and not traced, is that Chromium snaps glyphs to pixels at paint while layout reports the fractional baseline.
- React-pdf boxes are relative to the parent node, and right-aligned text needs `alignOffset`. The first attempt without `alignOffset` was off by 448 pt on the right-aligned invoice number. The layout data is an undocumented internal field, so any react-pdf integration pins an exact version and tests the extraction.
- Typst positions are page-relative points with a top-left origin, matching Docture's convention. Outside a `box`, `here().position()` in a right-aligned cell returned the cell's left edge, 29.6 pt left of the text. Wrapping each field in `box` fixes it but prevents line breaks inside a field.
- With standard Helvetica, PDFKit and react-pdf lose `buyer.name` and `discount` from the text layer. Only 67 of 69 fields match. See section 3.

## 2. Byte determinism

Each pair rendered the same invoice in two separate Node processes at least 1.1 s apart. "Raw" compares the files. "Dates pinned" first rewrites `/CreationDate` and `/ModDate` to a fixed string of equal length.

| Engine and fonts | Raw sha256 equal | After date rewrite | What varied | What pins it |
| --- | --- | --- | --- | --- |
| PDFKit, standard fonts, `info.CreationDate` fixed | yes | yes | nothing | the option alone |
| PDFKit, Arial TTF, `info.CreationDate` fixed | yes | yes | nothing | the option alone |
| PDFKit, no `info` | no | no | `CreationDate` and trailer `/ID` | `/ID` is an MD5 of the info dictionary, so the date leaks into it |
| Playwright, system fonts or TTF | no | yes | `CreationDate`, `ModDate` at one-second resolution | same-length rewrite after `page.pdf()` |
| react-pdf, `creationDate` and `modificationDate` fixed | yes | yes | nothing | Document props |
| react-pdf, no dates | no | no | `CreationDate` and `/ID` | same as PDFKit |
| Typst, `#set document(date: none)` | yes | yes | nothing | the template line |
| Typst, `date: auto` plus `creationTimestamp: 1767225600` | yes | yes | nothing | the `pdf()` option |
| Typst, `date: auto` without a timestamp | no | not tested | `CreationDate` and XMP `CreateDate` | use either row above |

Chromium writes no `/ID` and no XMP stream. Its font subset tags are sequential, `AAAAAA+` then `BAAAAA+`. A same-length rewrite leaves the xref offsets valid. `page.pdf()` has no option to set the dates. Typst subset tags such as `UHKCNN+` were stable across runs. PDFKit tags come from font registration order, for example `CZZZZZ+ArialMT`.

Cross-machine determinism is not measured. Playwright and Typst resolve system fonts. A Linux host has no `Helvetica.ttc` and would substitute another font, which is inferred and not run here. A pinned font file is required for any engine to match across hosts.

### PDFKit determinism recipe

Measured with standard Helvetica and with the embedded `/System/Library/Fonts/Supplemental/Arial.ttf` and `Arial Bold.ttf`.

```js
new PDFDocument({
  size: [595.28, 841.89],
  margin: 0,
  autoFirstPage: false,
  info: {
    CreationDate: new Date(Date.UTC(2026, 0, 1)),
    Producer: 'docture-synthetic',
    Creator: 'docture-synthetic',
  },
});
```

- `info.CreationDate` is the only required knob. PDFKit computes the trailer `/ID` from the info dictionary, so a fixed date fixes the `/ID`. PDFKit writes no `ModDate` unless you pass one.
- No post-processing is needed. Two processes produced identical bytes, as did a run under `TZ=Asia/Tokyo`. PDFKit writes the date in UTC as `D:20260101000000Z`.
- Subset tags follow font registration order. Register fonts in a fixed order and pass the same font bytes.
- A second check added `pdfVersion: '1.7'`, `subset: 'PDF/A-2b'`, `tagged: true`, `lang`, `displayTitle`, a PNG image and a link annotation. Output stayed byte-identical across processes. The PDF/A XMP packet takes its date from `info.CreationDate`.
- Not measured: stability across `pdfkit`, `fontkit` or zlib versions. Pin `pdfkit` exactly and treat a hash change after an upgrade as expected.

## 3. Fonts and missing glyphs

The glyph test renders `A−B ő 漢 Z` at 20 pt. Arial has U+2212 and `ő` but no `漢`. The table shows what a reader sees in the rendered PNG and what the text layer holds.

| Engine and font | Visible result | Text layer | Warning or error |
| --- | --- | --- | --- |
| PDFKit, standard Helvetica | `A"B ò"`. `Z` is gone | `A" B ò"` | none |
| PDFKit, Arial TTF | `A−B ő`, a `.notdef` box, `Z` | `漢` becomes U+0000 | none |
| react-pdf, standard Helvetica | `AB`, then `Q` and `"` drawn over `Z` with zero advance | `A B Q"Z` | none |
| react-pdf, Arial TTF | `A−B ő "Z`. It falls back to standard Helvetica for `漢` | `漢` becomes `"` | none |
| Playwright, system Helvetica or Arial `@font-face` | correct. `漢` comes from system PingFang | correct | none |
| Typst, system Helvetica or Arial | correct. `漢` comes from STSong or Arial Unicode in the font path | correct | none |
| Typst, Arial, `fallback: false` | `.notdef` box for `漢` | U+0000 | none from `takeWarnings()` |

Standard fonts fail differently in the two PDF libraries:

- PDFKit `AFMFont.encodeText` pushes `charCode.toString(16)` for any character outside its WinAnsi map. U+2212 becomes bytes `22 12`, a straight quote and a control code. `ő` becomes the three-digit `151`, which shifts every following hex nibble. In the invoice, `Fő utca 5` rendered as `FWF6P`. `widthOfString` still measures with `.notdef` widths, so the drawn discount ran 5.7 pt past its ground-truth right edge.
- React-pdf writes `glyph.id` as two hex digits and keeps the low byte. `ő` (U+0151) prints as `Q` and U+2212 prints as nothing.
- Neither library throws or warns. Only an embedded TTF that has the glyph is safe.

Decision for `@docture/synthetic`: always embed a TTF. Before drawing, reject any string with a code point the font lacks, using fontkit `hasGlyphForCodePoint`. That turns a silent `.notdef` into an error that names the field and the code point.

## 4. Speed and memory

Each row is a fresh process. It renders 3 warm-up documents, then 20 timed documents with distinct seeds. "First" includes module load and, for Playwright, browser launch. Peak tree RSS sums `ps` RSS for Node and every child process, sampled after each render. Spread is min to max over the 20 renders. The varied-seed benchmark ran three times. Medians moved by at most 0.8 ms, or 2.6 ms for the Playwright `data:` row. The table shows the last run.

| Engine and fonts | First, ms | Median, ms | Min to max, ms | Peak tree RSS, MB |
| --- | --- | --- | --- | --- |
| PDFKit, standard | 16.9 | 2.6 | 2.3 to 3.1 | 98 |
| PDFKit, Arial TTF | 49.3 | 23.7 | 21.5 to 27.5 | 293 |
| Playwright, system fonts | 148 | 9.0 | 8.4 to 9.7 | 510 |
| Playwright, TTF as `data:` URL | 229 | 91.5 | 89.9 to 94.1 | 765 |
| Playwright, TTF from a routed URL | 137 | 9.2 | 8.7 to 12.7 | 532 |
| react-pdf, standard | 62.1 | 13.4 | 12.0 to 14.8 | 289 |
| react-pdf, Arial TTF | 98.4 | 19.7 | 18.3 to 22.4 | 303 |
| Typst, system Helvetica | 52.6 | 5.3 | 4.6 to 7.8 | 164 |
| Typst, Arial | 39.4 | 5.2 | 4.8 to 5.7 | 154 |

What limits each number:

- PDFKit with a TTF costs 21 ms more than standard fonts. A CPU profile puts the top self-time in fontkit table decoding (`_setup`, `decode`). PDFKit reparses the font for every document. A plain `fontkit.create` is lazy and took 0.11 ms, so the cost is the per-document table and subset work.
- Playwright with `data:` URL fonts decodes 2.0 MB of base64 font, 1.5 MB of TTF, on every `setContent`. Serving the same files through `page.route` with a cache header brought the median to 9.2 ms. Use the routed form in any Playwright tier.
- Typst first measured 1.7 ms when every render used the same invoice. Its compiler memoizes compilation, so those renders were cache hits. With distinct seeds per render it measured 5.2 ms. The compiler cache also grows RSS. `evictCache` exists and is untested here.
- The Playwright median excludes browser launch. One browser and one page served all renders. Its RSS is dominated by the Chromium process tree.

## 5. Install weight

`du -sh node_modules` with each engine installed alone on darwin-arm64.

| Engine | `node_modules` | Packages | Extra |
| --- | --- | --- | --- |
| `pdfkit` | 25 MB | 20 | none |
| `playwright-core` | 13 MB | 1 | Chromium headless shell 203 MB, full Chromium 366 MB |
| `@react-pdf/renderer` + `react` | 36 MB | 62 | none |
| `@myriaddreamin/typst-ts-node-compiler` | 44 MB | 2 | 44 MB is the native platform binary |
| `pdfjs-dist` | 63 MB | 2 | verification only |
| `sharp` | 29 MB | n/a | degradation stage, version 0.35.5 |

## Degradation approach

The degradation stage works on rasterized pages and keeps boxes in sync with the pixels.

- Use `sharp` for overlays, blur, noise composites and the final encode.
- Model geometry as one 3x3 homography per page. `sharp.affine()` takes a 2x2 matrix, so it cannot express perspective. Warp the raw RGBA buffer in JS by inverse mapping. For each output pixel, apply the inverse homography and sample the source with bilinear interpolation.
- Transform every ground-truth box with the same matrix. Map the four corners, then store the quad and its axis-aligned bounding box. The quad stays exact under perspective. The bounding box is what most extractors score.
- Derive the RNG per page, stage and knob from the document seed. Changing one knob then leaves every other knob's random draws unchanged, and a single page can be regenerated alone.

## Corpus throughput

Measured on 2026-10-29 on one macOS laptop with Node 24.14. Each run used `docture synth corpus` with the CLI test invoice and its `classic` template, with the default pool. Every digital case is rendered and then verified through PDF.js.

| Run | Wall time | Peak RSS |
|---|---|---|
| 1,000 digital cases | 55.8 s, about 56 ms per case | 488 MB |
| 200 digital cases | 11.8 s | 489 MB |
| The same 1,000 cases again, all skipped | 0.41 s | 143 MB |
| 50 cases at `scan:0.5`, 200 dpi | 19.0 s wall, 32.9 s CPU, about 380 ms per case | 879 MB |

- Peak memory does not grow with corpus size: 200 and 1,000 digital cases peak at the same 488 MB. The pool bounds the work in flight.
- The 1,000 digital cases take 35 MB on disk.
- A scan costs about 7 times a digital case. The likely main cost is the JS warp, one loop over every output pixel; this was not profiled. At this rate 1,000 scans take about 6 minutes. That does not justify worker threads yet; revisit if users need scan corpora in the tens of thousands.

## Prior art

Each line says what the project does and what this package takes from it. Sources were read on 2026-10-28.

- **SynthTIGER** ([clovaai/synthtiger](https://github.com/clovaai/synthtiger), MIT). Generates OCR text-line images with labels, character boxes and masks. Take its per-component config and seeded sampling.
- **SynthDoG** ([clovaai/donut](https://github.com/clovaai/donut)). The Donut document generator. Its README lists SynthTIGER as a prerequisite and runs through the `synthtiger` CLI. Take the idea of a template plus seeded pipeline producing pretraining pages. Its rendering details were not confirmed here.
- **DocSynth** ([arXiv 2107.02638](https://arxiv.org/abs/2107.02638), ICDAR 2021). Generates document images from a layout of category-labelled boxes, with code adapted from layout2im. Take layout-first generation. An image generator cannot guarantee readable text for ground truth, so the model itself does not fit.
- **kashodev/docsynth** ([GitHub](https://github.com/kashodev/docsynth), MIT, Python). Generates synthetic invoices with known values to score extraction pipelines. It is the closest goal match. Take its scoring-fixture framing.
- **Augraphy** ([sparkfish/augraphy](https://github.com/sparkfish/augraphy), MIT). Degrades clean document images through ink, paper and post phases with effects such as `BadPhotoCopy`, `InkBleed` and `Jpeg`. Take the phase split and the effect catalogue. It does not track boxes.
- **Genalog** ([microsoft/genalog](https://github.com/microsoft/genalog), MIT, maintenance mode). Renders text through HTML templates, adds scan degradation and aligns OCR output to propagate labels. Take HTML templates as a variety source.
- **DocCreator** ([LaBRI](https://doc-creator.labri.fr/), LGPL-3.0). Generates ground-truthed document images with degradation models including bleed-through, ink degradation, adaptive blur, holes and paper deformation. Take the degradation list. The exact model count differs between sources and is unconfirmed.
- **DocDjinn** ([arXiv 2602.21824](https://arxiv.org/abs/2602.21824)). Uses VLMs to generate annotated documents from unlabelled seeds, with clustering-based seed selection and diffusion handwriting. Take seed-distribution matching as a later option.
- **FlexDoc** ([arXiv 2510.02133](https://arxiv.org/abs/2510.02133)). Samples layout, visual design and content from probabilistic models to produce multilingual semi-structured documents. Take parameterized sampling of layout and style knobs.
- **Layout-preserving invoice synthesis** ([arXiv 2508.03754](https://arxiv.org/abs/2508.03754)). OCRs a real invoice, swaps fields with LLM text, inpaints and redraws in place. Take nothing for v1. It needs real source invoices and an image model.
- **@faker-js/faker** (10.6.0, MIT). Generates locale-aware fake names, addresses and companies. Use it for field values with a seeded instance.

## Decision

- **PDFKit is the default.** Boxes are exact because the renderer places every glyph. It produced byte-identical output with one option, at 2.6 ms standard or 23.7 ms with a TTF. Always embed a TTF and pre-check glyph coverage. Standard fonts corrupt text silently. A future speedup is to reuse parsed fonts across documents; it is not measured.
- **HTML through Playwright is the variety tier.** It gives CSS layout variety and system-grade glyph fallback. Boxes come within 0.27 pt of the text layer. It needs fixed-size page containers, a same-length date rewrite, routed font URLs and a 203 MB browser. Ship it as an optional peer with a recipe, never as a default dependency.
- **Typst** matched PDFKit on boxes and determinism. It was faster than PDFKit with an embedded TTF, 5.2 ms against 23.7 ms. It would need a template-authoring story, a pinned font set, a decision on the 44 MB native binary per platform, and a warning for missing glyphs, which `takeWarnings()` did not report. Revisit it if users want declarative templates.
- **react-pdf** recovered exact boxes only through the undocumented `_INTERNAL__LAYOUT__DATA_`. It would need a public layout API or an exact pin with an extraction test. It would also need a fix for its standard-font low-byte encoding and its Helvetica fallback for glyphs a TTF lacks.

## Rebuilding pfnur's toll statement on this package

Measured on 2026-10-28. The question is what it costs to rebuild pfnur's Toll4Europe statement, layout `t4e`, on `@docture/synthetic`. It also asks what the rebuild gains and loses. pfnur is the `syntetic-documents` repository at commit `99ea341`, plus uncommitted edits in the three files counted below. The runs used `pdfkit` 0.19.1, `pdfjs-dist` 6.2.108, `sharp` 0.35.5 and `zod` 4.4.3 on the machine in the setup table.

### What T4e renders

T4e is a react-pdf template for an A4 "Mautaufstellung". The table flows across as many pages as its rows need. Page 1 carries the wordmark, the sender lines, the recipient block, the date and the heading `Mautaufstellung <year>-BAG-<statementNo>`. A meta block follows with the billing period, the customer number and the fixed arrangement `Maut-Service-Partner`. The table has one row per vehicle, sorted heaviest first, with these columns:

- position, country, plate, OBU serial, contract number
- `Betrag [EUR]`, the vehicle's summed amount
- `Anteil externer Kosten [EUR]`, its summed external-cost share

Continuation pages repeat the grey header. The last page adds the `Gesamtsumme` row and four closing paragraphs. Page 1 also carries a raster contact box and the BAG crest. Every page repeats the wordmark, the legal footer and `Seite n von N`.

Placement is by hand. `paginate()` splits rows by fixed capacities, and `<Abs>` puts each block at a measured point coordinate. Its constants give 19 rows on page 1, 37 on a continuation page and 25 when the closing block shares the page. Flexbox lays out only the table cells and the meta rows.

`context()` in `src/data/statement.ts` sums each vehicle's positions into `t4eRows` and `t4eTotals` as German strings. It builds the heading reference with `t4eStatementNo()`. Ground truth comes from `T4E_PRINTED`, a per-field declaration in `T4e.tsx`. `expectedStatement()` in `src/render/expected.ts` walks the layout-agnostic `source.json`. It keeps each printed field, nulls the rest, collapses `positions` to `null`, adds per-vehicle and grand totals, and orders vehicles with `t4eVehicleOrder()`. It records values only. pfnur stores no field boxes, and nothing reads the PDF back to check them.

### The rebuild

The sketch models the fields T4e prints. It also models the positions behind each vehicle's amount, so `derive` has something to sum, and masks them as unprinted. It reuses pfnur's three PNG assets. It typechecks against the package source with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import { before, defineModel, defineTemplate, drawTable, gen, locales, prints, sumOf, unique, validIban } from "@docture/synthetic";
import type { Formatter, Surface, TableColumn } from "@docture/synthetic";

const Position = z.object({ procedure: z.enum(["AV", "MV", "TN"]), metres: z.number().int(), extCents: z.number().int(), amountCents: z.number().int() });
const Vehicle = z.object({
  countryCode: z.enum(["D", "PL", "CZ"]), plate: z.string(), obu: z.string(), contractNumber: z.string(),
  positions: z.array(Position).min(1), amountCents: z.number().int(), extCents: z.number().int(),
});
type Vehicle = z.infer<typeof Vehicle>;
export const TollStatement = z.object({
  customerNumber: z.string(), statementNo: z.string(), date: z.string(), periodFrom: z.string(), periodTo: z.string(),
  company: z.object({
    name: z.string(), contact: z.string().optional(), department: z.string().optional(),
    address: z.object({ street: z.string(), postalCode: z.string(), city: z.string(), country: z.string() }),
  }),
  payment: z.object({ method: z.enum(["Lastschrift", "Überweisung"]), iban: z.string(), mandateRef: z.string() }),
  vehicles: z.array(Vehicle).min(1),
  totalAmountCents: z.number().int(),
  totalExtCents: z.number().int(),
});
export type TollStatement = z.infer<typeof TollStatement>;

const RATE = { AV: [14, 22], MV: [14, 22], TN: [16, 24] } as const;
const DISTRICTS = ["B", "HH", "M", "K", "F", "S", "HB", "DD", "L", "N", "MZ", "WOB"];
const PL_PREFIX = ["WA", "WB", "PO", "GD", "KR", "WR", "LU", "SK", "SZ", "EL", "DW", "RZ"];
const LETTERS = [..."ABCDEFGHJKLMNPRSTVWXYZ"];
const pad2 = (n: number): string => String(n).padStart(2, "0");
const sum = <K extends string>(rows: readonly Readonly<Record<K, number>>[], key: K): number => rows.reduce((total, row) => total + row[key], 0);

function withTotals(value: TollStatement): TollStatement {
  const vehicles = value.vehicles
    .map((vehicle) => ({ ...vehicle, amountCents: sum(vehicle.positions, "amountCents"), extCents: sum(vehicle.positions, "extCents") }))
    .sort((a, b) => b.amountCents - a.amountCents);
  return { ...value, vehicles, totalAmountCents: sum(vehicles, "amountCents"), totalExtCents: sum(vehicles, "extCents") };
}

export const tollModel = defineModel(TollStatement, {
  fields: {
    customerNumber: gen.pattern("78#####"),
    statementNo: gen.pattern("69########"),
    periodFrom: gen.from(({ stream }) => `2025-${pad2(stream.int(1, 11))}-01`),
    periodTo: gen.from(({ get }) => {
      const [year, month] = get<string>("periodFrom").split("-").map(Number) as [number, number];
      return `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
    }),
    date: gen.dateAfter("periodTo", { days: [3, 12] }),
    "company.name": gen.pick(["Spedition Nordwind GmbH", "Trans-Kowalski Sp. z o.o.", "Huber Logistik KG"]),
    "company.contact": gen.maybe(gen.pick(["Frau Petra Vogel", "Herr Jan Brandt"]), 0.8),
    "company.department": gen.maybe(gen.pick(["Fuhrparkleitung", "Buchhaltung"]), 0.6),
    "company.address.street": gen.pick(["Industriestraße 45", "Hafenweg 7", "Am Güterbahnhof 12"]),
    "company.address.postalCode": gen.pattern("#####"),
    "company.address.city": gen.pick(["Bremen", "Hamburg", "Leipzig", "Dortmund"]),
    "company.address.country": gen.value("DEUTSCHLAND"),
    "payment.method": gen.value("Lastschrift"),
    "payment.iban": gen.iban("DE"),
    "payment.mandateRef": gen.pattern("B000########"),
    vehicles: gen.array({ length: [1, 50] }),
    "vehicles[].countryCode": gen.weighted([["D", 6], ["PL", 3], ["CZ", 1]]),
    "vehicles[].plate": gen.from(({ stream, sibling }) => {
      const country = sibling<Vehicle["countryCode"]>("countryCode");
      if (country === "D") return `${stream.pick(DISTRICTS)} ${stream.pick(LETTERS)}${stream.pick(LETTERS)} ${stream.int(10, 9999)}`;
      if (country === "PL") return `${stream.pick(PL_PREFIX)} ${stream.int(1000, 99999)}${stream.pick(LETTERS)}`;
      return `${stream.int(1, 9)}${stream.pick(LETTERS)}${stream.int(1, 9)} ${stream.int(1000, 9999)}`;
    }),
    "vehicles[].obu": gen.pattern("0000700#######"),
    "vehicles[].contractNumber": gen.from(({ stream }) =>
      stream.chance(0.02) ? `10${stream.int(30000, 39999)}` : `90${String(stream.int(900, 2200)).padStart(4, "0")}`,
    ),
    "vehicles[].positions": gen.array({ length: [1, 4] }),
    "vehicles[].positions[].procedure": gen.pick(["AV", "MV", "TN"] as const),
    "vehicles[].positions[].metres": gen.from(({ stream }) => stream.int(15, 1200) * 100),
    "vehicles[].positions[].amountCents": gen.from(({ stream, sibling }) => {
      const [low, high] = RATE[sibling<Vehicle["positions"][number]["procedure"]>("procedure")];
      return Math.round((sibling<number>("metres") / 1000) * stream.int(low, high));
    }),
    "vehicles[].positions[].extCents": gen.from(({ sibling }) => Math.round(sibling<number>("amountCents") * 0.13)),
  },
  derive: withTotals,
  constraints: [
    sumOf("vehicles[].amountCents", "totalAmountCents"),
    sumOf("vehicles[].extCents", "totalExtCents"),
    before("periodFrom", "periodTo"),
    before("periodTo", "date"),
    validIban("payment.iban"),
    unique("vehicles[].obu"),
  ],
});

const image = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./assets/${name}`, import.meta.url)));
const [LOGO, CREST, CONTACT_BOX] = ["t4e_logo.png", "t4e_bag_crest.png", "t4e_contact_box.png"].map(image) as [Uint8Array, Uint8Array, Uint8Array];
const [NAME, SUB, HEAD_BG] = ["#717273", "#7d7e80", "#e4e4e4"];
const ISSUER = "Toll4Europe GmbH";
const PAYMENT_METHOD = "Maut-Service-Partner";
const LEGAL = [
  "Sitz: Berlin, Geschäftsführung: Mirka Dworschak, Thomas Laissle, Andrea Scheu and Ewa Conewa (Eva Tzoneva)",
  "Registergericht: Berlin, HRB.-Nr.: 175193 B, Ust-IdNr. DE 306242805",
];
const CLOSING = [
  "Im Gesamtbetrag der Maut sind, in Abhängigkeit von der Schadstoffklasse, die Kosten enthalten, die durch die Luftverschmutzung des Fahrzeugs entstehen. Mehr dazu auf www.toll4europe.eu.",
  "Wir wünschen Ihnen weiterhin gute Fahrt!",
  "Mit freundlichen Grüßen",
  ISSUER,
];
const [TABLE_X, TABLE_W, P1_TOP, CONT_TOP, BOTTOM, CLOSING_RESERVE, PAD] = [70, 496, 386, 120, 726, 190, 3.6];
const ROW = { size: 9.5 } as const;
const HEAD = { size: 8.5, font: "bold" } as const;

const columns = (f: Formatter): TableColumn<Vehicle>[] => [
  { header: "Position", width: 47, text: (_, index) => String(index + 1).padStart(5, "0") },
  { header: "Land der Zulassung", width: 56, key: "countryCode", text: (v) => v.countryCode },
  { header: "KFZ-Kennzeichen", width: 96, key: "plate", text: (v) => v.plate },
  { header: "OBU", width: 94, key: "obu", text: (v) => v.obu },
  { header: "Vertrag", width: 65, key: "contractNumber", text: (v) => v.contractNumber },
  { header: "Betrag [EUR]", width: 68, key: "amountCents", align: "right", text: (v) => f.number(v.amountCents / 100, 2) },
  { header: "Anteil externer Kosten [EUR]", width: 70, key: "extCents", align: "right", text: (v) => f.number(v.extCents / 100, 2) },
];

/** Replays drawTable's page breaks, because the footer prints "Seite n von N" before the table is drawn. */
function paginate(rows: number, rowH: number, headH: number): { pages: number; closingAlone: boolean } {
  let [pages, y] = [1, P1_TOP + headH];
  for (let i = 0; i < rows; i++, y += rowH) if (y + rowH > BOTTOM) [pages, y] = [pages + 1, CONT_TOP + headH];
  const closingAlone = y + CLOSING_RESERVE > BOTTOM;
  return { pages: closingAlone ? pages + 1 : pages, closingAlone };
}

export const t4e = defineTemplate<TollStatement>()({
  key: "t4e",
  family: "toll-statement",
  tags: { issuer: "toll4europe" },
  locale: locales["de-DE"],
  printed: {
    customerNumber: true, statementNo: true, date: true, periodFrom: true, periodTo: true,
    company: { name: true, contact: true, department: true, address: { street: true, postalCode: true, city: true, country: true } },
    payment: { method: prints(() => PAYMENT_METHOD), iban: false, mandateRef: false },
    vehicles: { items: { countryCode: true, plate: true, obu: true, contractNumber: true, positions: false, amountCents: true, extCents: true } },
    totalAmountCents: true,
    totalExtCents: true,
  },
  draw(page, s, f) {
    const cols = columns(f);
    const rowH = page.measure("0", ROW).height + PAD * 2;
    const headH = Math.max(...cols.map((c) => page.measure(c.header, { ...HEAD, width: c.width - PAD * 2 }).height)) + PAD * 2;
    const { pages, closingAlone } = paginate(s.vehicles.length, rowH, headH);
    const headerFill = (top: number): void => page.rect({ x: TABLE_X, y: top, width: TABLE_W, height: headH }, { fill: HEAD_BG });
    const chrome = (): void => {
      page.image(LOGO, { x: 366, y: 52, width: 200, height: 45.77 });
      page.text(ISSUER, { x: 70, y: 796, size: 8, font: "bold", color: NAME });
      LEGAL.forEach((line, i) => page.text(line, { x: 70, y: 808 + i * 11, size: 7.5, color: SUB, width: 470 }));
      page.text(`Seite ${page.pageNumber} von ${pages}`, { x: 566, y: 815, size: 8, color: NAME, align: "right" });
    };

    chrome();
    page.text(ISSUER, { x: 70, y: 125, size: 9, font: "bold", color: NAME });
    page.text("Französische Straße 33 a-c, 10117 Berlin, Germany", { x: 70, y: 135, size: 8, color: SUB });
    const { company: c } = s;
    const recipient: [Parameters<Surface<TollStatement>["field"]>[0], string | undefined][] = [
      ["company.name", c.name],
      ["company.contact", c.contact],
      ["company.department", c.department],
      ["company.address.street", c.address.street],
      [["company.address.postalCode", "company.address.city"], `${c.address.postalCode} ${c.address.city}`],
      ["company.address.country", c.address.country],
    ];
    let y = 150;
    for (const [path, text] of recipient) {
      if (text === undefined) continue;
      page.field(path, text, { x: 70, y, size: 11 });
      y += 15.95;
    }
    page.text(ISSUER, { x: 467, y: 125, size: 9, font: "bold", color: NAME });
    ["Französische Straße 33 a-c", "10117 Berlin", "Germany"].forEach((line, i) => page.text(line, { x: 467, y: 138 + i * 11.9, size: 8.5, color: SUB }));
    page.field("date", f.date(s.date), { x: 467, y: 251, size: 9 });

    const title = { x: 70, y: 287, size: 16.5, font: "bold" } as const;
    page.text("Mautaufstellung", title);
    page.field("statementNo", `${s.date.slice(0, 4)}-BAG-${s.statementNo}`, { ...title, x: 70 + page.measure("Mautaufstellung ", title).width });
    const meta = [
      ["Abrechnungszeitraum", ["periodFrom", "periodTo"], `${f.date(s.periodFrom)} - ${f.date(s.periodTo)}`],
      ["Kundennummer", "customerNumber", s.customerNumber],
      ["Zahlungsmittel", "payment.method", PAYMENT_METHOD],
    ] as const;
    meta.forEach(([label, path, text], i) => {
      page.text(label, { x: 70, y: 323 + i * 15.6, size: 11 });
      page.field(path, text, { x: 230, y: 323 + i * 15.6, size: 11 });
    });
    page.image(CONTACT_BOX, { x: 70, y: 740, width: 242, height: 36.92 });
    page.text("Im Auftrag des", { x: 384, y: 736, size: 9, color: "#555555" });
    page.image(CREST, { x: 468, y: 738, width: 98, height: 55.52 });

    headerFill(P1_TOP);
    y = drawTable(page, {
      path: "vehicles", items: s.vehicles, columns: cols, x: TABLE_X, y: P1_TOP, bottom: BOTTOM, continueAt: CONT_TOP,
      reserveAfter: CLOSING_RESERVE, padding: PAD, style: ROW, headerStyle: HEAD,
      onPage: () => {
        chrome();
        if (!(closingAlone && page.pageNumber === pages)) headerFill(CONT_TOP);
      },
    });

    const bold = { ...ROW, font: "bold", y: y + PAD } as const;
    page.rect({ x: TABLE_X, y, width: TABLE_W, height: rowH }, { fill: HEAD_BG });
    page.text("Gesamtsumme", { ...bold, x: TABLE_X + PAD });
    page.field("totalAmountCents", f.number(s.totalAmountCents / 100, 2), { ...bold, x: 428 + PAD, width: 68 - PAD * 2, align: "right" });
    page.field("totalExtCents", f.number(s.totalExtCents / 100, 2), { ...bold, x: 496 + PAD, width: 70 - PAD * 2, align: "right" });
    y += rowH + 26;
    CLOSING.forEach((paragraph, i) => {
      const at = { x: 70, y: y + (i > 0 ? 18 : 0), size: 11, width: TABLE_W, lineGap: 5 };
      page.text(paragraph, at);
      y = at.y + page.measure(paragraph, at).height;
    });
  },
});
```

Results from running it:

- 40 seeds rendered and passed `verifyLabels`. They held 2 to 49 vehicles and 6,383 labels. 0 labels failed.
- A sweep of 1 to 120 rows read each page's `Seite n von N` with `pdftotext` and compared it with the page count. 0 pages disagreed.
- An 80-row statement put 19, 36 and 25 rows on its pages. pfnur's capacities give 19, 37 and 25.
- `writeCorpus` with 3 seeds and `digital()`, `scan({ severity: 0.3 })` and `fax({ severity: 0.5 })` wrote 9 cases in 5.9 s. A rerun skipped all 9 in 8 ms. `jsonlDataset` from `@docture/eval` loaded the manifest as 9 cases in 3 groups with 1,893 location paths.
- Page 1 beside pfnur's page 1 at 60 dpi differs, by eye, in three places. Header labels sit at the top of the band, a 0.5 pt rule runs under the header, and `Betrag [EUR]` fits on one line.

### Line counts

`wc -l` gives the totals. An awk pass drops blank and comment-only lines for code lines. Code characters count the non-whitespace characters on code lines, which corrects for line width. The sketch runs to 191 columns and `T4e.tsx` to 128.

| Code | Lines counted | Total | Code lines | Code chars |
| --- | --- | --- | --- | --- |
| pfnur template and printed declaration | `src/render/templates/T4e.tsx` 1-395 | 395 | 298 | 8,150 |
| pfnur T4e share of `context()` and helpers | `src/data/statement.ts` 358-399, 636-659, 683-689, 693-702, 747-748 | 85 | 50 | 1,472 |
| pfnur T4e-specific total | both rows above | 480 | 348 | 9,622 |
| pfnur generation behind T4e's fields, shared by every layout | `src/data/statement.ts` 38-106, 184-355 | 241 | 159 | 4,348 |
| pfnur ground-truth masking, shared by every layout | `src/render/expected.ts` 1-353 | 353 | 159 | 4,476 |
| Sketch | lines 1-214 | 214 | 201 | 10,230 |

In the sketch, lines 1-23 are the schema, 25-89 the generators, `derive` and constraints, and 91-214 the template and mask. All counts are measured.

Total lines fall from 480 to 214, but comments and line width explain most of the drop. By code characters the sketch is 10,230 against 9,622 for pfnur's T4e-specific code, and the sketch also holds the generators that pfnur keeps in 4,348 shared characters. The rebuild is about the same size. It gains capabilities, not brevity.

### What the package adds

- **Field boxes.** Each `page.field()` records path, value, drawn text, page and box in PDF points, top-left origin. The 80-row statement carried 494 labels. `drawTable` labels keyed cells as `vehicles[i].plate` and so on.
- **Label verification.** `verifyLabels` reads the digital PDF through PDF.js and checks that each label's text lies inside its box, with 2 pt tolerance. `writeCorpus` runs it before writing. A field drawn without a declaration, or declared and never drawn, fails the render with `TemplateError`. pfnur's types force every field into `T4E_PRINTED`, but nothing checks the page against it.
- **Degradation with boxes.** `degrade` rasterizes each page, warps it by one homography and maps every label box through the same matrix. In a `photo` rendition at severity 0.6, the `totalAmountCents` box on page 2 moved from x 463.3, y 123.6, 29.1 × 8.8 to x 469.1, y 134.8, 28.3 × 9.0. The stored box is the axis-aligned bound of the warped quad. pfnur's `src/scan` makes the same four renditions in the same paper, geometry, bed and encode stages, and records each page's draws in `scan.json`. It copies `expected.json` unchanged and has no boxes to move.
- **Resumable corpus.** `writeCorpus` keys each case by a SHA-256 of seed, scenario, template, rendition, creation date, package version and a fingerprint of schema, template and scenario. It skips a case only when the key and every file hash match, and lands each case by renaming a finished folder. pfnur skips a rendition whenever its `doc.pdf` exists, unless `--force` is given.
- **Eval manifest.** Each `manifest.jsonl` row carries `documents`, `expected`, `tags`, `params`, `group` and `locations`. Tags hold template, family, scenario, rendition, severity bucket, locale and the template's own tags. Every rendition of one rendering shares a group. pfnur's `MANIFEST.md` is a table for people, and its `expected.json` names the layout and rendition in `meta`.

### What the rebuild loses or still needs

- **Coordinates instead of flexbox.** T4e already places almost everything with `<Abs>`, so little layout logic is lost. Table cells and meta rows become explicit x offsets. The recipient block becomes one field per line at a fixed 15.95 pt leading, so each line gets its own box.
- **`drawTable` gaps.** It paints no header fill, so the sketch paints the grey band with `rect`, before the table and in `onPage`. It top-aligns header labels where T4e bottom-aligns them, and draws a rule T4e lacks. It takes one `bottom` for every page, which costs one row per continuation page. A surface cannot return to an earlier page, so `Seite n von N` needs `paginate()` to replay the break rule. That copy agrees on 1 to 120 rows today and would drift silently if `drawTable` changed. `onPage` cannot tell whether a header follows, so the sketch skips the fill on a closing-only page itself.
- **Fonts.** pfnur's T4e renders in unembedded standard Helvetica. `pdffonts` on a fresh render from the current tree lists only Helvetica and Helvetica-Bold. `tw("font-sans")` clears the family, as `src/render/tw.ts` warns, so the FiraGO comment in `src/data/format.ts` is stale for T4e. The sketch keeps the same standard faces. In pdfkit's Helvetica, `€`, `ä` and `ß` map to glyphs, and `ł`, `ą` and U+2212 map to `.notdef`. The renderer turns `.notdef` into a `TemplateError` that names the field, so a recipient in `Łódź` fails the render instead of printing garbage. Polish names need an embedded TTF through `fonts`, such as pfnur's FiraGO. Section 4 measured about 21 ms more per document for an embedded TTF. The `de-DE` preset's ASCII minus matches pfnur's `eurPlain`.
- **Ground-truth spelling.** Labels and `expected` carry schema values. Dates are ISO, such as `2025-10-07` for a printed `07.10.2025`. Money is integer cents, and `statementNo` is the bare number inside the printed reference. pfnur also keeps the bare number and integer cents, but its dates are the German strings its dataset stores. A scorer must normalize dates, or the schema must store the printed form.
- **Cache invalidation.** The fingerprint hashes function source text but not the values a function captures. Moving the table top in the sketch from 386 to 300 pt and rerunning `writeCorpus` skipped all 3 cached digital cases. After editing a constant or an asset, delete the corpus or change `createdAt`.
- **Not ported.** Credits, reversals and fees (`Gutschrift`, `Stornierung`, `Stornierungsgebühr`), journey records and the named edge cases in pfnur's `src/data/corpus.ts` have no equivalent in the sketch. Each would be a `scenario` with `fields` or `shape`. pfnur's other layouts could share this schema and mask `positions` as printed where they show them.
