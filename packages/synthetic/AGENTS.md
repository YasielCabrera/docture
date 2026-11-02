# Using @docture/synthetic

Read this file explicitly before writing models, templates or corpus scripts with
`@docture/synthetic`. A coding agent can read
`node_modules/@docture/synthetic/AGENTS.md`; automatic discovery inside dependencies
is not assumed. The documentation site's `/llms.txt` lists every guide as Markdown.

```sh
npm install @docture/synthetic docture zod pdfkit
```

A model (`defineModel`) produces seeded values that satisfy the extraction schema.
A template (`defineTemplate`) draws them and declares every schema field in
`printed`, so the labels it returns are correct by construction: each value with
the page and box where it is printed. The same seed always produces the same
document.

```ts
import { defineModel, gen } from "@docture/synthetic";
import { z } from "zod";

const Receipt = z.object({ store: z.string(), totalCents: z.number().int() });
const model = defineModel(Receipt, {
  fields: {
    store: gen.pick(["Corner Market", "Blue Fern Cafe"]),
    totalCents: gen.int(99, 4_999),
  },
});
const sample = await model.sample({ seed: 1 });
sample.value; // { store: "Corner Market", totalCents: 1177 }
```

Each optional engine has its own entry and must be installed beside the
application: `pdfkit` for `@docture/synthetic/pdfkit`, `pdfjs-dist` for
`/verify` and `/measure`, `sharp`, `pdfjs-dist` and `@napi-rs/canvas` for scan,
photo and fax renditions, `react` and `@react-pdf/renderer` for
`/react-pdf`, `playwright-core` for `/html`, and `ai` for `/llm`. A missing
engine throws `MissingEngineError` naming the package to install.

Install `@faker-js/faker@10.6.0` explicitly to use `fakerFor` from `/faker`.
Generate individual fields with `gen.pattern`, `gen.pick`, `fakerFor`, and
`gen.from`. The consuming schema owns the record shape. Use `get` or `sibling`
for related values. `gen.iban({ country, bban })` computes an IBAN string from
caller-generated BBAN fields. Keep national formatting rules and catalogue
metadata in the consuming model. Existing `gen.iban(country?)` calls retain
their random numeric BBAN behavior.

Use `valuePool` for structured records in any JSON data model or locale. Use
`llmObjectPool` from `/llm` for opt-in provider generation. Both require a
runtime-validating Standard Schema with input JSON Schema conversion, an exact
count of distinct outputs, and a validation-policy revision. They validate cache
hits and preserve transformed outputs. Caches store raw input records. A corrupt
cache fails without a provider call. Explicit `cache-only` sources require a
cache and never generate missing records. Keep provider mocks in wiring tests.

Declare captured bank catalogues, pool values, rule revisions, renderer pins and
asset bytes in `dependencies` on the model or corpus configuration. Values must
be JSON data or `Uint8Array` bytes. The corpus stores hashes, keeps case IDs, and
rewrites cases when declared inputs change. The writer records peer versions,
including Faker and AI, without importing their runtime code. Function source
hashes do not discover undeclared closure inputs.

Verify rendered documents before using them as ground truth. `assertVerified`
from `@docture/synthetic/verify` reads the PDF back and fails with
`LabelVerificationError` when a value is not inside its box. `writeCorpus` from
`@docture/synthetic/node` verifies every case and writes `manifest.jsonl`, which
`jsonlDataset` from `@docture/eval/node` reads.

Template errors are design errors, not flaky renders. A field drawn without a
`printed` declaration, a declared field that is never drawn, or a glyph missing
from the font fails with `TemplateError`; fix the template rather than catching
the error. Pass font bytes in `fonts` for characters outside the standard PDF
fonts.

`docture synth` in `@docture/cli` runs the same steps from a `docture.synth.ts`
file typed with `defineSynthConfig`.
