# A fourth publication for synthetic documents

Status: accepted. Date: 2026-10-28.

## Decision

Publish `@docture/synthetic` beside `docture`, `@docture/cli`, and `@docture/eval`. Keep the ESM, per-file output, explicit exports, lazy engines, error identity, and tree-shaking rules from [ADR 0001](0001-package-boundaries.md) and [ADR 0002](0002-eval-publication.md).

`@docture/synthetic` requires `docture` as a peer. Its portable root has no Node built-ins and no engines. The root holds models, generators, constraints, scenarios, printed masks, templates, table layout, locale formatting, the document and label types, and `toEvalCase`. Each engine has a narrow entry:

| Entry | Purpose | Engines |
| --- | --- | --- |
| `./pdfkit` | Render a template to a labeled PDF | `pdfkit` |
| `./verify` | Read labels back from the text layer | `pdfjs-dist`, through `docture/loaders/pdfjs` |
| `./degrade` | Scan, photo, and fax renditions with transformed boxes | `sharp`, `pdfkit`, and `docture/raster/canvas` |
| `./faker` | Locale-aware generators | `@faker-js/faker` |
| `./llm` | Cached text pools from a model | `ai` |
| `./html` | Render an HTML template with Chromium | `playwright-core` |
| `./node` | Write a corpus to disk | None directly |

Only `./node` imports `node:` built-ins. It can also import `pdfkit/`, `verify/`, and `degrade/`, because the corpus writer orchestrates rendering, verification, and degradation. Their engines still load lazily, when a case uses them.

Projects own their datasets. The corpus writer emits the JSONL manifest that `@docture/eval`'s `jsonlDataset` reads, including each field's `locations`. Synthetic has no runtime dependency on eval. `toEvalCase` returns a structural copy of `EvalCase`.

The package bundles no fonts. Templates use the standard 14 PDF fonts or font bytes that the user supplies. A bundled-font entry would need its own asset-resolution allowance in the boundary check, as the PDF.js and canvas adapters have.

`docture/testing/fixtures` stays in `docture`. Synthetic peers on `docture`, so moving the fixtures into synthetic would create a dependency cycle.

`docture synth` lives in `@docture/cli`, which keeps the only binary.

## Why

Synthesis has heavy engines and its own release lifecycle. `sharp` ships native binaries, and the HTML renderer drives Chromium. Neither belongs in an extraction install. Generators, templates, and degradation profiles change independently of extraction, so a separate publication gives them their own dependency contract while preserving per-entry isolation.

Ground truth is correct by construction. A value is sampled, then drawn, and the drawing call records the box. The verifier then reads the rendered page back. Eval already reads JSONL manifests with locations, so a corpus scores with no labeling and no shared runtime code.

## Engines

Every synthetic-only engine is an exact pin until the packed gate verifies a range: `sharp`, `@faker-js/faker`, and `playwright-core`. Their engine matrix records floor and current as the same pinned version. `pdfkit`, `pdfjs-dist`, `@napi-rs/canvas`, and `ai` reuse docture's verified ranges, because docture's gate already runs their floors and newest releases.

Each entry exports `ENGINE_RANGES` for the engines it loads. An absent peer raises docture's `MissingEngineError`, naming the engine, its range, and the entry.

## Release

Add `@docture/synthetic` to the Changesets fixed group with the other three publications. The new error codes `SYNTHESIS_FAILED`, `TEMPLATE_INVALID`, and `LABEL_VERIFICATION_FAILED` join docture's error code union, so `DoctureError` consumers can switch on them.

## Enforcement

`pnpm lint` asserts the four-package set and keeps synthetic public. It checks the following synthetic rules:

- Root files import only root files. Each entry folder imports root files and its own folder. `node/` can also import `pdfkit/`, `verify/`, and `degrade/`.
- Only `node/` imports Node built-ins. Each entry can import only its declared `docture` subpaths.
- Each engine is imported only by its entry and only with `import()`. A type-only import is allowed in that entry.
- Each engine an entry loads appears in that entry's `ENGINE_RANGES`, with a range equal to the optional peer. Every peer has a range or reuses docture's.
- `sharp`, `@faker-js/faker`, and `playwright-core` are exact pins equal to the development versions. `pdfkit`, `pdfjs-dist`, and `@napi-rs/canvas` equal docture's ranges.
- The manifest has `sideEffects: false`, one explicit export per entry folder, per-file targets, a node-only `./node`, a required `docture` peer, and no runtime dependencies.
- `packages/synthetic/src` has no `Date.now()`, no zero-argument `new Date()`, and no `Math.random()`. Time is an input, and randomness comes from `streamFor(seed, key)`.

`pnpm verify:packages` packs all four packages and installs the tarballs outside the workspace with npm and pnpm. Without optional engines, it imports every synthetic entry, compares each `ENGINE_RANGES` with the packed peers, and type-checks the declarations of every entry whose types name no engine. It also checks per-file output and `sideEffects: false`. It probes `MissingEngineError` for `renderPdf`, `degrade`, `./faker`, `./html`, and `./llm`. It also checks that a `SynthesisError` from a second installed copy is recognized.

The gate builds an esbuild browser bundle of the root and rejects any entry folder, non-core docture module, or engine in it, with a mutation control. With only `pdfkit` installed, it renders a labeled invoice from the packed `./pdfkit` entry. With the pinned engine matrix installed, it verifies labels, degrades a page, generates faker values, launches the HTML renderer up to Chromium, and type-checks the engine-typed entries. It also writes a corpus that packed eval's `jsonlDataset` reads with locations.

The ordinary typecheck, behavioral tests, and build remain release gates. Rendering with a real Chromium build and live model calls need local installs or credentials; deterministic tests cover them in CI.
