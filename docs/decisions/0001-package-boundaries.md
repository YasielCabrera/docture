# Two publications with isolated ESM entry points

Status: accepted. Date: 2026-10-22.

## Decision

Publish `docture` and `@docture/cli`. Consolidate the existing core, LLM, eval, loader, rasterizer and testing implementations physically into `packages/docture`. Keep their module boundaries through explicit subpath exports and automated import checks.

The root `docture` entry exports core extraction, conversion, contracts and plugin interfaces. Model implementations live under `docture/llm`. Narrow entries such as `docture/llm/text`, `docture/llm/classifier` and `docture/llm/vision` expose independent capabilities. Loaders use `docture/loaders/<engine>`, rendering uses `docture/raster/canvas`, and scoring uses `docture/eval`. Testing has separate doubles, fixtures and conformance entries.

Emit one ESM file per source file. Internal imports are relative. Within one installed copy, every entry reaches the same physical core modules, so entries share core classes. The export map is deliberate and does not expose implementation wildcards. The package declares `sideEffects: false`; imports must remain free of observable startup work.

One process can still load several installed copies. pnpm installs `docture` once per resolved peer set, so an application config and `@docture/cli` with different AI SDK versions hold different class objects. Error recognition therefore does not depend on physical identity: each `DoctureError` class declares a stable identity, and its `Symbol.hasInstance` accepts an instance of the same class from any copy. `instanceof`, `errorCodeOf()` and `isAbortError()` give the same answer for every copy. A subclass declared outside Docture keeps ordinary `instanceof` behavior. Other classes are not shared across copies. TypeScript also treats each copy's class with private fields as a distinct type, so the CLI types a config's `extractor` and `converter` by the methods it calls rather than by the classes.

Third-party engines are optional peers of `docture`. Consumers explicitly install the engines their selected subpaths need. Development installs include all engines at exact versions to verify the integrations reproducibly. The AI SDK and Zod are peers for model features. Core retains its existing schema-helper dependency, whose own peer requirements still apply. The JSON Schema declaration package is a normal dependency because the helper exposes those types to consumers. Pure JavaScript HTML syntax utilities (`parse5`, `htmlparser2`, and `entities`) are also normal dependencies, loaded only when DocumentLoaderData reads HTML or XHTML. They parse text without optional engines, native startup or resource downloads.

npm applies an optional peer's range whenever the application installs that package, even if the application never imports the adapter. With every engine pinned exactly, an application that already used `pdfjs-dist@6.3.289` or `pdfkit@0.17.2` could not install `docture` with npm at all, and pnpm silently linked the untested version. An engine peer now declares a range only after the packed-package gate verifies the range's floor and the newest release inside it: `pdfjs-dist` `^6.2.108` (6.2.108, 6.3.289, 6.4.299), `@napi-rs/canvas` `^1.0.10` (1.0.10, 1.0.13), `mupdf` `~1.28.0` (1.28.0, 1.28.1) and `pdfkit` `>=0.17.2 <0.21.0` (0.17.2, 0.19.1, 0.20.2). Zod accepts `^3.25.76 || ^4.1.8`, the range the AI SDK and its schema helper support. Tesseract.js, PaddleOCR and ONNX Runtime stay exact because their recognition is verified only with downloaded models. A version outside a range remains unsupported: npm reports `ERESOLVE` and pnpm warns about an unmet peer.

Some engines load another engine themselves. PDF.js resolves its own `@napi-rs/canvas` for `Path2D` and its helper canvases, and declares it as an optional dependency: `^1.0.0` through 6.3.289 and `^1.0.10` in 6.4.299. A canvas context rejects a `Path2D` from another installed canvas. The rasterizer therefore draws on a surface from PDF.js's own canvas factory, whichever canvas the package manager gave PDF.js; its own canvas import only reports a missing peer. The canvas range also starts inside the requirement of every supported PDF.js version, so npm and pnpm can install one canvas for both. With a 1.0.3 floor, PDF.js 6.4.299 received a second canvas and five of the eight rasterizer conformance tests failed, although both managers reported a clean install. A coupled pair is verified in both cross combinations, the floor of one beside the newest release of the other, with npm and pnpm.

One process still runs one PDF.js version. When pnpm gives the application and the CLI different `pdfjs-dist` versions, a PDF.js loader built in the config cannot be combined with the CLI's rasterizer. The CLI guide documents the two working arrangements.

An application that already depends on another release of an exact OCR peer cannot install `docture` with npm, even for core use. The installation guide documents an npm override, `"docture": { "<engine>": "$<engine>" }`, for core and non-OCR entries. It does not make that release supported for the OCR adapters.

Adapters import their engines on first use. An absent engine package raises `MissingEngineError` with the package, its supported range and the entry that needs it. Only a module-not-found error naming one of the entry's declared peers is translated; PaddleOCR declares ONNX Runtime because the engine imports it. When every eligible loader lacks its engine, loading raises that error instead of `LoadFailedError`, so a missing install is not reported as a damaged file.

The CLI depends on `docture`, the AI SDK and PDF.js. Native canvas remains an optional dependency of the CLI, preserving the previous default installation when the platform supports it. Optional dependencies install by default; they are different from optional peers.

Testing doubles require no test runner or PDF generator. Fixtures require PDFKit. Conformance suites require Vitest and generate documents with those PDFKit fixtures. Splitting the entries prevents application consumers and test-double users from loading either tool.

## Why

The old eleven-package layout increased release and installation choices with every adapter. Publication boundaries were duplicating integration boundaries. Subpaths preserve explicit capabilities while keeping the number of Docture publications fixed.

A shared core avoids duplicate class definitions from separately bundled entries. Optional peers keep engines out of installs that do not select them, and verified ranges let an application keep its own engine version inside the supported range. ESM graphs and narrow exports preserve bundler visibility. No runtime registry is needed; the existing structural plugin contracts continue to support custom components.

The selected design physically consolidates modules rather than publishing an umbrella that still depends on all the old packages. Separate engine packages remain an option only for integrations with their own assets or platform lifecycle, and require another decision.

## Tree-shaking contract

A production bundler can exclude modules outside the imported entry's reachable graph and remove unused exports within that graph. The packed-package gate verifies narrow consumers with esbuild and Rollup. It inspects emitted module contributions and exercises the resulting code.

Optional peers control engine installation. They do not perform tree shaking. All Docture wrapper files ship in the single library tarball. Unbundled Node applications and externalized dependencies do not receive bundler pruning.

Convenience classes remain supported. A used `LLM` instance references extraction, vision, classification, layout and splitting methods. Bundlers need not remove individual unused methods or runtime branches from a used class. Consumers seeking the narrow text graph import `llm` from `docture/llm/text` and compose it with core. The same principle applies to future convenience APIs.

## Migration and release

This is a breaking import and dependency change within the project's pre-1.0 minor-release policy. Replace old scoped package imports with the corresponding `docture/...` entry. Move root model imports such as `LLM` to `docture/llm`. Install the selected engine packages explicitly. The documentation includes a migration table and install recipes.

Old scoped package names remain in historical changelog entries. They are not active workspace packages. This change does not publish or deprecate anything in the npm registry. Registry deprecation and release execution are separate release actions.

## Enforcement

`pnpm lint` checks source import boundaries, optional-peer declarations, explicit ESM exports and exactly two active publications. Every LLM module has a declared role: engine-free helpers import neither the AI SDK nor Zod, a capability imports only helpers and shared modules, and only the extractor factory and the convenience modules combine capabilities. The existing core architecture and export tests continue to enforce core layering and its exact runtime API.

`pnpm verify:packages` packs the actual packages and installs outside the workspace with npm and pnpm. It checks imports and declarations, optional-engine isolation, selected engine behavior, shared core identity, CLI execution and narrow production bundles. It also executes every entry in an engine-free install, probes each adapter for `MissingEngineError`, builds a production profile for every independent LLM entry with mutation controls (two widen an entry's exports, and two add a forbidden import while keeping the entry's export list), runs the engine ranges at their floor and newest versions and each coupled pair in both cross combinations with npm and pnpm, installs beside an application's own engine versions and both Zod families, renders pages with the CLI beside an application's newest PDF.js, checks the OCR override for core use, and runs typed and untyped CLI configs from an application whose AI SDK differs from the CLI's. This gate must pass for entry, dependency and packaging changes.

The ordinary typecheck, behavioral tests, documentation coverage and executable examples remain release gates. Agent instructions in the root `AGENTS.md` point to these checks. New integrations must extend both the public documentation and the isolation evidence.
