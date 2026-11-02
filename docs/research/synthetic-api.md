# Implemented synthetic API

The declarations in `packages/synthetic/src` are authoritative. [ADR 0003](../decisions/0003-synthetic-publication.md) records the package boundaries.

All examples use this invoice type:

```ts
type Invoice = { invoiceNumber: string; issuedAt: string; totalCents: number; note: string | null };
```

## Root: `@docture/synthetic`

The root is portable. It has no Node built-ins and no engines.

- `defineModel(schema, options)` accepts a Standard Schema such as Zod 4.2 or later, a Docture contract, an AI SDK schema, or a JSON Schema branded with `typedJsonSchema<T>()`. `model.sample({ seed, scenario? })` returns `Sample<T>` with `value`, `seed`, `scenario` (`"base"` by default), and `tags`. Sampling runs generators, a scenario's `shape`, `derive`, the constraints, and the scenario's `expect`, then validates against the schema. A failure raises `SynthesisError` (`SYNTHESIS_FAILED`).
- Field paths use eval's path format. `Fields<T>` keys are patterns such as `lineItems[].amountCents`.
- `gen` has `value`, `from`, `int`, `float`, `pick`, `weighted`, `pattern`, `date`, `dateAfter`, `words`, `iban`, `luhn`, `absent`, `null`, `maybe`, and `array({ length })`.
- `gen.iban(country?)` retains random numeric BBAN generation using its country-length table. `gen.iban(options: IbanOptions)` accepts `country: string | Generator<string>` and `bban: Generator<string>`, validates their syntax and known lengths, and returns one checksum-derived IBAN string. The caller owns the record schema, national BBAN assembly and catalogue metadata. Use `gen.pattern`, `gen.pick`, `fakerFor`, and `gen.from` with `get` or `sibling` to compose other reusable field values. Checksum validity does not establish an account exists.
- `valuePool({ schema, revision, count, source, cache?, dependencies? })` returns exactly `count` distinct validated outputs as a defensive, deep-frozen JSON array. `RuntimeSchema<Output>` structurally requires Standard Schema runtime validation and input JSON Schema conversion. Validated `result.value` preserves defaults and transforms. Plain JSON Schema is insufficient. `ValuePoolOptions` requires a `PoolSource` with either `kind: "generate"`, nonempty `id`, and `generate(count)`, or `kind: "cache-only"` and the same `id`. Cache-only sources require a `PoolCache`.
- `PoolCache.get(key)` returns raw cached inputs or `undefined`; `set(key, values)` stores raw input arrays. Keys include source identity, input JSON Schema, required validation-policy `revision`, count, and canonical dependencies. Hits undergo the same validation as new records. Raw inputs avoid double-applying output transforms. Wrong counts, invalid records, duplicate validated outputs, and corrupt caches fail with `SynthesisError` without fallback generation. A cache-only miss also fails. `llmTextPool` retains its separate string trim/dedup contract.
- `DependencyInputs` maps names to `DependencyValue`: JSON data or `Uint8Array` bytes, including nested arrays and records. Models declare captured generation inputs through `ModelOptions.dependencies`. Corpus plans and CLI configs declare rendering inputs through `dependencies`. Canonical identity ignores record insertion order, preserves array order, distinguishes bytes, and rejects lossy values, accessors, cycles, and unsupported objects.
- The constraints are `sumOf`, `before`, `validIban`, `validLuhn`, `unique`, and `constraint(name, check)`. `valuesAt` lists concrete paths for a pattern.
- `scenario({ name, tags?, fields?, shape?, expect? })` defines a named variation that keeps the model's invariants.
- `streamFor(seed, key)` is the only source of randomness. Each position draws from a stream keyed by its path, so adding a field does not change the other fields' values.
- Templates are `defineTemplate<T>()({ key, family, locale, printed, draw, aliases?, tags?, page?, fonts? })`. `printed` is a `PrintedMask<T>` that declares every key, including optional ones. A key is `true`, `false`, a predicate, or `prints(transform)`. `draw(surface, value, format)` calls `surface.field(path, text, at)` for labeled text and `surface.text` for decoration. `drawTable` paginates rows and labels keyed columns. `selectTemplates` resolves keys, aliases, families, or `all`.
- `formatter(locale)` formats money, dates, and numbers for the entries in `locales`. `defaultFonts` are the standard 14 PDF faces, and `pageSizes` holds the paper sizes.
- `SyntheticDocument` holds `bytes`, `mimeType`, `pages`, `expected` (the sample with each unprinted position set to `null`), `labels` (`FieldLabel` with `path`, `value`, `text`, `pageNumber`, `box`), `sample`, `template`, `rendition`, and `provenance`. Boxes are PDF points with the origin at the top left and y pointing down, like Docture's `LayoutBox`.
- `toEvalCase(document)` returns an `EvalCase`-shaped `SyntheticCase` with `locations`, `group`, tags, and params, without importing eval.
- The errors are `SynthesisError`, `TemplateError` (`TEMPLATE_INVALID`), and `LabelVerificationError` (`LABEL_VERIFICATION_FAILED`). Each one declares its own `doctureErrorIdentity`.

```ts
import { defineModel, defineTemplate, gen, locales, scenario, typedJsonSchema } from "@docture/synthetic";

const model = defineModel(typedJsonSchema<Invoice>({ /* JSON Schema */ }), {
  fields: { invoiceNumber: gen.pattern("INV-######"), issuedAt: gen.date({ from: "2025-01-01", to: "2025-12-31" }), totalCents: gen.int(100, 99_999), note: gen.pick([null, "Thanks!"]) },
});
const zero = scenario<Invoice>({ name: "zero-total", fields: { totalCents: gen.value(0) }, expect: (v) => v.totalCents === 0 });
const sample = await model.sample({ seed: 7, scenario: zero });

const classic = defineTemplate<Invoice>()({
  key: "classic", family: "invoice", locale: locales["de-DE"],
  printed: { invoiceNumber: true, issuedAt: true, totalCents: true, note: (note) => note.length > 0 },
  draw(page, value, f) {
    page.field("invoiceNumber", value.invoiceNumber, { x: 50, y: 50 });
    page.field("issuedAt", f.date(value.issuedAt), { x: 50, y: 64 });
    page.field("totalCents", f.money(value.totalCents), { x: 545, y: 90, align: "right" });
    if (value.note) page.field("note", value.note, { x: 50, y: 120, width: 300 });
  },
});
```

## `@docture/synthetic/pdfkit`

`renderPdf(template, sample, { createdAt?, producer?, creator?, title?, compress? })` returns a digital `SyntheticDocument`. The creation date is fixed by default, so equal inputs give equal bytes. A drawn field that `printed` does not declare, a declared field that is never drawn, or a glyph missing from the font raises `TemplateError`. The engine is `pdfkit`.

```ts
import { renderPdf } from "@docture/synthetic/pdfkit";
const document = await renderPdf(classic, sample);
document.labels.find((label) => label.path === "totalCents"); // { text: "0,00 €", pageNumber: 1, box: { … } }
```

## `@docture/synthetic/verify`

`verifyLabels(document, { tolerance? })` reads a digital rendition through `docture/loaders/pdfjs`. It returns `{ ok, checked, failures }`, where each failure is `missing`, `outside-box`, or `page-overflow`. `assertVerified` raises `LabelVerificationError` instead. A degraded rendition has no text layer and raises `RangeError`. The engine is `pdfjs-dist`.

```ts
import { assertVerified } from "@docture/synthetic/verify";
await assertVerified(document);
```

## `@docture/synthetic/degrade`

`degrade(document, { profile, severity, dpi?, output?, salt? })` rasterizes each page with `docture/raster/canvas` and applies paper, geometry, scanner-bed, and encoding stages. It moves every label box through the same homography. `profile` is a key of `profiles` (`scan`, `scan-lq`, `photo`, or `fax`) or a custom `Profile`. `severity` runs from 0 to 1. The output is a PDF by default, or PNG or JPEG for a one-page document. Draws come from `streamFor`, keyed by template, scenario, profile, severity, salt, page, stage, and knob. `transformBox` is exported for custom geometry. The engines are `sharp` and `pdfkit`, plus `pdfjs-dist` and `@napi-rs/canvas` through docture's canvas rasterizer.

```ts
import { degrade } from "@docture/synthetic/degrade";
const scan = await degrade(document, { profile: "scan", severity: 0.5, dpi: 200 });
scan.rendition; // { kind: "scan", severity: 0.5, dpi: 200 }
```

## `@docture/synthetic/faker`

`fakerFor(locale, { refDate? })` resolves a Faker locale with an English fallback. It returns a factory that turns `build(faker)` into a `Generator`. Each generated value reseeds Faker from its own position's stream, so a value depends only on the seed and its path. Relative dates count back from `refDate`, never from the wall clock. The supported optional engine is `@faker-js/faker` version `10.6.0`; consumers install and pin it explicitly.

```ts
import { fakerFor } from "@docture/synthetic/faker";
const fake = await fakerFor("de");
defineModel(schema, { fields: { "buyer.name": fake((faker) => faker.company.name()) } });
```

## `@docture/synthetic/llm`

`llmTextPool({ model, prompt, count, cache?, temperature? })` asks an AI SDK model once for `count` distinct strings and caches them by model, prompt, count, and temperature. Sample from the pool with `gen.pick`, so ground truth stays the sampled value. The engine is `ai`.

`llmObjectPool<Output>(options: ObjectPoolOptions<Output>)` uses `valuePool` for structured records. Options include `schema`, required `revision`, `count`, `prompt`, optional `temperature`, optional `dependencies`, and either `source: { kind: "model", model }` with optional cache or `source: { kind: "cache-only", model: "provider/model-id" }` with required cache. Model identity, prompt, and temperature enter the pool key. Provider responses and cached inputs both undergo runtime validation. Cache-only reads never load AI. Only a genuine model-source cache miss can make a provider call. Deterministic mocks verify provider wiring; schema validity does not establish geographic facts.

```ts
import { llmTextPool } from "@docture/synthetic/llm";
const names = await llmTextPool({ model: "openai/gpt-5", prompt: "Fictional titles for a book catalogue", count: 50, cache });
defineModel(schema, { fields: { "seller.name": gen.pick(names) } });
```

## `@docture/synthetic/html`

`defineHtmlTemplate<T>()({ key, family, locale, printed, render, css?, page?, aliases?, tags? })` defines a template whose `render(value, format)` returns one `<section class="page">` per page. Each printed field sits in an element with `data-field="<path>"`. `renderHtmlPdf(template, sample, { browser?, executablePath?, createdAt? })` prints the page with Chromium and labels each field with its element's box. `escapeHtml` escapes text for content and attributes. The engine is `playwright-core`, plus a Chromium build that the user installs.

```ts
import { defineHtmlTemplate, escapeHtml, renderHtmlPdf } from "@docture/synthetic/html";
const web = defineHtmlTemplate<Invoice>()({
  key: "web", family: "invoice", locale: locales["en-US"], printed: { invoiceNumber: true, issuedAt: false, totalCents: true, note: false },
  render: (v, f) => `<section class="page"><h1 data-field="invoiceNumber">${escapeHtml(v.invoiceNumber)}</h1><p data-field="totalCents">${f.money(v.totalCents)}</p></section>`,
});
const htmlDocument = await renderHtmlPdf(web, sample);
```

## `@docture/synthetic/node`

`writeCorpus(directory, { model, templates, seeds, dependencies?, scenarios?, includeBase?, renditions?, concurrency?, verify?, createdAt?, signal? })` renders each seed, scenario, and template once. It derives each rendition from `digital()`, `scan()`, `scanLq()`, `photo()`, or `fax()`, and writes `manifest.jsonl`, `coverage.json`, and `failures.jsonl`. A rerun skips cases whose key and files match. Each case lands by renaming a finished temporary folder, so an interrupted run converges on the next attempt. A rendering that fails verification is listed in `failures`, and the rest of the batch continues. The manifest rows are `jsonlDataset` rows with `locations`. This is the only entry that imports `node:` built-ins. Its engines are those of the requested renditions, plus `pdfjs-dist` for verification, which is on by default.

The writer validates and snapshots model and corpus dependencies before filesystem mutation. `corpus.json.dependencies` holds named SHA-256 digests under `model` and `corpus`, plus a combined `hash`. Those hashes enter freshness keys without persisting raw input values. Changes rewrite cases under the same IDs. The writer derives observed engine names from the synthetic package peers and reads installed versions without importing engines, including Faker and AI. Missing peers appear as `null`. Aliased renderer pins remain declared inputs and do not replace observed versions. Function source fingerprints still cannot discover undeclared closure values or imported helper changes. `SynthConfig.dependencies` reaches the same writer through `docture synth corpus`.

```ts
import { digital, scan, writeCorpus } from "@docture/synthetic/node";
import { jsonlDataset } from "@docture/eval/node";
const report = await writeCorpus("corpus", { model, templates: [classic], seeds: [1, 2, 3], renditions: [digital(), scan({ severity: 0.4 })] });
const dataset = jsonlDataset(report.manifest);
```
