# @docture/docs

The documentation site. [Fumadocs](https://fumadocs.dev) 16 on Next.js 16.

```sh
pnpm docs                      # from the repo root → http://localhost:3100
SITE_URL=https://your-docs.example pnpm --filter @docture/docs build
pnpm --filter @docture/docs typecheck
```

## Brand assets

The approved brand kit in `../../brand/` owns the logo geometry, colors, icons,
and social image. `components/brand-logo.tsx` displays the original outlined SVGs
in shared navigation and the footer. The site's existing `.dark` class selects
the matching artwork without client-side theme state.

Synchronize the deployed subset after updating the brand kit:

```sh
pnpm --filter @docture/docs brand:sync
pnpm --filter @docture/docs check:brand
```

Run these commands from the repository root. `check:docs` also checks that the
deployed assets match their canonical sources. The sync script copies only the
assets used by the site, including `app/brand.css`, `lib/brand.json`, the public
logo and app icons, and Next's favicon, Apple icon, and Open Graph image files.
It derives `app/manifest.webmanifest` from the kit template with public icon paths
and `display: browser` for this documentation site.

Next generates the favicon, manifest, and social-image metadata from those files.
Twitter uses the same Open Graph image. Page titles and descriptions continue to
come from each page. The existing Geist and Geist Mono font loaders retain the
full weight range used by the interface; the logo itself requires no font.

Set `SITE_URL` to the site's absolute deployed origin when building outside
Vercel, for example through the hosting platform's environment settings. The root
layout validates it with `new URL` and uses it as `metadataBase`. Vercel can use
Next's native deployment-origin fallback. Development can fall back to localhost
for absolute social-image URLs. Production builds reject a missing origin before
generating the sitemap. No production domain is assumed by this repository.
The package-level `turbo.json` passes the origin settings to
Next and includes them in the build cache key. Changes to the canonical kit and
deployed public assets also invalidate their relevant checks.

## Navigation and page width

Home and documentation use `components/site-header.tsx` through Fumadocs header
slots. `components/docs-header.tsx` supplies the notebook's mobile sidebar trigger.
The primary links come from `primaryNavigation` in `lib/shared.ts`.

Use `site-container` for outer page sections. Its 80rem maximum width and responsive
gutters live in `app/global.css`; the notebook grid uses the same width token.
Keep article, sidebar, and table-of-contents widths inside that shared outer frame.
The header uses inline-size containment so its controls do not change the notebook
grid's minimum column sizes.
Scrollbar space stays reserved so short and long pages retain the same alignment.

## Content and navigation

`content/docs/` contains canonical MDX pages. Its eight areas are Getting started,
Extraction, Conversion and retrieval, Evaluation, Synthetic data, CLI and services,
Integrations, and Resources. Each area has an `index.mdx` and explicit `meta.json`
ordering. Area folders explicitly set `root: false`; reference folders have no root override.
The layout disables section tabs, so every page keeps the same collapsible
documentation tree. Section headings link to `pagesIndex: "index"`; omit `index`
from their `pages` arrays so the introduction appears only on the heading. The
`SidebarSection` renderer keeps the link and caret as separate keyboard controls.
An active section link toggles its group; other section links open their introduction.

`content/docs/api.mdx` is the global API index. `api-reference.ts` assigns public
exports from all four published packages to their canonical reference pages.

`lib/docs-migration.json` maps old routes and headings to current pages. One-to-one
moves use permanent redirects. Split pages use a small client bridge because URL
fragments never reach the server. The bridge preserves query strings and includes a
canonical fallback link. Legacy pages stay outside the MDX source, search, and LLM
indexes. Old Markdown URLs redirect to the current Markdown page.

`lib/source.ts` supplies page rendering, search, previous/next navigation, Markdown,
`llms.txt`, and `llms-full.txt`. Keep one canonical page per topic.

## Write a page

Open with the task or behavior. A guide includes prerequisites, working code or a
`SourceExample`, expected output, constraints that affect the task, and next links.
Keep lookup details in reference. Preserve defaults, errors, capability limits, and
engine install recipes when splitting a page. Use short sentences and plain words.

The pipeline, bundle-splitting, and architecture pages contain accessible Mermaid
diagrams. Include `accTitle` and `accDescr`. `components/mdx/mermaid.tsx` provides zoom
and expansion. `lib/mermaid-markdown.ts` preserves the original chart text for
Markdown before MDX attribute escaping. Register plugins through the global `mdxOptions` function in
`source.config.ts`; replacing collection-level options drops the Fumadocs defaults
that parse tables and feed search.

## Generate reference indexes

```sh
pnpm --filter @docture/docs generate:commands
pnpm --filter @docture/docs generate:api
pnpm --filter @docture/docs generate:fields
pnpm --filter @docture/docs generate:installs
```

Command pages come from the CLI's command definitions. The API index comes from the
public export inventory. Commit their generated MDX with source changes.

## Verify documentation

```sh
pnpm --filter @docture/docs check:docs
pnpm --filter @docture/docs check:examples
pnpm --filter @docture/docs typecheck
pnpm --filter @docture/docs test
pnpm --filter @docture/docs build
```

`check:docs` verifies public exports and imports, recipes, links, anchors, migration
destinations, navigation coverage, area order, prose rules, and generated files.
`typecheck` also checks TypeScript examples and runs the documentation checks.
`check:examples` executes offline recipes and application tests using generated PDFs and removes its
temporary files. Model-backed examples compile; live execution needs credentials.

Keep the [installation recipes](content/docs/getting-started/installation.mdx) and
[migration guide](content/docs/resources/migration.mdx) consistent with manifests.

## Keep generated documentation current

`generate:api` derives symbol names, import aliases, descriptions, and real reference links from the public inventory. The same records drive the API filter, JSON export, and Markdown. `generate:fields` derives requiredness from TypeScript declarations while preserving authored meanings. `generate:installs` reads supported peer requirements and the synthetic recipe's Zod 4.2 JSON Schema floor. It uses major constraints where they cover the supported versions and keeps necessary lower floors, minor caps, and exact-only engine constraints. Broader support still requires the packed engine matrix.

Declare task phrases in a page's `tasks` frontmatter. Search and `/llms-tasks.txt` use those phrases from the same canonical page. `/llms/<area>.txt` provides scoped page discovery. Markdown contains the page type and source revision. Outside GitHub or Vercel builds, set `DOCS_REVISION` before invoking Turbo so the revision participates in its cache key. Unconfigured builds label the revision unavailable. Production builds need `SITE_URL` or Vercel's production origin so the sitemap cannot be empty.

Mark self-contained TypeScript fences with `check` to compile them. Use `signature` for API syntax and `expect-error` for deliberate failures. Unmarked blocks are labelled code excerpts; they do not promise a complete program. Complete source examples retain their filenames. Code labels are numbered within each page for accessible region navigation.
