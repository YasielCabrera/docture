# Three publications with an independent eval package

Status: accepted. Date: 2026-10-28.

## Decision

Publish `docture`, `@docture/cli`, and `@docture/eval`. Keep the ESM, per-file output, explicit exports, lazy engines, error identity, and tree-shaking rules from [ADR 0001](0001-package-boundaries.md). Any further publication needs its own decision.

`@docture/eval` has a portable, engine-free root for specs, comparators, alignment, scoring, metrics, the result model, and gates. Each other capability has a narrow entry. Root comparators live in `src/compare/`. Run comparison lives in `src/comparison/`, exported as `@docture/eval/compare`.

Projects own dataset layouts and ground-truth formats. Eval owns the in-memory `EvalCase`, the processor contract, and the versioned `EvalResult` disk format. `EvalResult` version 1 has a published JSON Schema. Reporters, gates, comparison, and offline rendering consume that result.

`@docture/eval` requires `docture` as a peer. Runtime imports use core error and engine helpers from `docture`. The Docture adapter can also import `docture/llm/pricing`. Other Docture imports are type-only. The optional `ai` peer belongs only to the judge entry. The judge imports it lazily, and an absent peer raises docture's `MissingEngineError`.

`@docture/cli` depends on `@docture/eval` as a normal dependency and keeps the only binary. `docture eval` is a shell over the programmatic API. Eval adds no default engines.

## Why

Evaluation has its own dataset, processor, result, and reporting contracts. Those contracts support processors outside Docture. A separate publication gives evaluation its own dependency contract while preserving capability isolation through subpaths.

Project-defined datasets avoid imposing a directory layout. One result format lets a saved run support another reporter, a new gate, or run comparison without another extraction. Raw processor outputs remain available for re-scoring.

## Tree-shaking contract

Each reporter entry is Node-only because it also exports a file-writing factory that imports `node/artifacts`. The pure `render*` implementations have no Node imports; this does not make their entry points browser-safe.

Only `node/` imports Node built-ins. The root reaches no runner, reporter, adapter, judge, or Node implementation. Other entries import root modules and their own implementation. The runner can use dataset helpers. Node I/O can use dataset helpers and runner types. The Docture adapter can use runner types. Reporters can use shared reporter helpers but cannot import each other.

The HTML client is prebuilt into a checked-in source module. Reports work offline from packed output without asset resolution or network access. The freshness check rejects stale generated code.

## Migration and release

Delete `docture/eval` in the same pre-1.0 minor release that first publishes `@docture/eval`. Migrate callers in that release and keep no compatibility layer. Move `checkConversion` to `@docture/eval/conversion`.

Use one Changesets fixed group for all three publications. Eval's `docture` peer range tracks the current minor. Eval is public in this release.

## Enforcement

`pnpm lint` asserts the three-package set, rejects unknown packages. It checks eval's directory roles, portable entries, engine peers against `ENGINE_RANGES`, and HTML client freshness.

`pnpm verify:packages` packs all three public packages and installs its tarball outside the workspace with npm and pnpm. It imports every manifest entry without optional engines, checks declarations, verifies per-file output and `sideEffects: false`, and recognizes errors across installed copies.

The completed gate builds esbuild and Rollup production bundles for the root, runner, and reporters with mutation controls. It probes the judge for `MissingEngineError`, checks cross-copy `OutOfScopeError`, renders packed HTML offline, and runs the packed CLI on a two-case fixture. These checks are added with their implementations; absent probes do not count as passes.

The ordinary typecheck, behavioral tests, build, documentation coverage, and runnable examples remain release gates. Live model calls require credentials. Deterministic mocks cover model behavior in CI.
