# 04-capabilities-and-composition — Capabilities and composition

> typed loader capabilities, `requires`, `withRasterizer`, both rasterizers, lazy memoized page images.

**Needs:** `pnpm run fetch`. No API key.

```sh
pnpm --filter @docture/examples capabilities
```

Docs: [`concepts/rasterizers`](../../docs/content/docs/integrations/rasterizers.mdx)

## Imports and installs

Import capabilities and `withRasterizer` from `docture`, PDF readers from
`docture/loaders/pdfjs` and `docture/loaders/mupdf`, and `NapiCanvasRasterizer` from
`docture/raster/canvas`.

For a separate application:

```sh
pnpm add docture pdfjs-dist mupdf @napi-rs/canvas zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

**Half of this example is checked by `pnpm typecheck`, not by running it.** The four
`@ts-expect-error` lines at the top of `index.ts` are the point:

```ts
const dataIsText: TextLoader = new DocumentLoaderData();          // fine

// @ts-expect-error — DocumentLoaderData reports `geometry: false`.
const dataHasGeometry: GeometryLoader = new DocumentLoaderData();
```

Delete one and **the typecheck fails**, because the error it expects would no longer be
there. That is a test of the library's type-level guarantee, written as an example.

## Reading and rendering are separate plugins

Bundling them would mean choosing an OCR engine also chooses how pages get rendered.
Here they compose, and the composition's *type* says it can now do both:

```ts
const loader = withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer({ dpi: 300 }));
//    ^? DocumentLoader<LoaderCapabilities<true, true, true>>
```

## The measurement worth seeing

```
pages in the document      6
image() calls made         3
distinct pages touched     2
actual renders             2
```

Two renders for three calls across six pages. `page.image()` renders that page and
memoizes it, so a 200-page document a strategy looks at two pages of costs two renders.
The example counts them by wrapping the rasterizer, which is the only honest way to show
it.

## What to read next

[`05-your-own-plugins`](../05-your-own-plugins) — writing a strategy, a loader and a
rasterizer.
