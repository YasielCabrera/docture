# Ship release documentation once in docture

Status: accepted. Date: 2026-11-09.

## Decision

The main `docture` publication includes a generated `docs/` directory covering all
four packages. The CLI depends on `docture`; eval and synthetic require it as a
peer. Their agent guides resolve that installed copy rather than carrying another
documentation bundle. The four-package publication boundary stays unchanged.

The website and package exporter share Markdown conversion. Source examples and
API references are expanded, internal links become local Markdown links, and task,
area, and symbol indexes support selective reading. Generated documentation is not
checked into Git. Builds and packing regenerate it from repository sources without
starting or building the website.

`docture/docs/manifest.json` is an explicit data export. It identifies the artifact
schema, exact documented versions, source revision, release status, page inventory,
and file hashes. Resolving it does not import the runtime. Documentation remains
outside the runtime graph and adds no consumer dependencies or installation hooks.

The Changesets fixed group coordinates releases but does not require every installed
peer to have the same patch version. Consumers compare the manifest's version map
with their installed packages. A CLI-only or multi-copy installation resolves docs
from the package whose behavior it needs, without guessing pnpm store paths.

## Build and release

The package build generates the documentation after TypeScript compilation. Its
Turbo task is uncached because provenance includes the current Git revision; its
inputs also cover docs, examples, generated references, package versions, and
changesets so downstream task hashes reflect documentation changes.

`prepack` regenerates the artifact, including for a docs-only edit after a prior
build. `prepublishOnly` rejects pending changesets, dirty source checkouts, or
unavailable source revisions. Changesets already consumed in an active prerelease
are recognized through `.changeset/pre.json`; new changes still require versioning.
Development packing remains available with an explicit unreleased status. Each
snapshot contains ordinary files that work with installation scripts disabled.

`pnpm docs:bundle` builds the snapshot independently in `packages/docture/docs/`.
`pnpm release` validates this snapshot before publishing the npm packages. The
`docture` package contains the documentation folder directly.

## Enforcement

Exporter tests exercise local links and anchors, expanded examples, code preservation,
release metadata, deterministic output, and removal of stale files. The packed gate
checks the complete file inventory and hashes, exact versions, and offline discovery
from real npm and pnpm consumers, including nested and multiple-copy contexts.
Existing import, type, and bundle checks preserve runtime isolation.
