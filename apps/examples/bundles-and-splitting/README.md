# Split a statement into account documents

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Use `Process` with a heading splitter and a small account-summary parser. The local six-page PDF contains checking, a credit line, and a reconciliation form.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples bundles
```

The checking group is pages 1 to 3, the credit-line group is pages 4 to 5, and page 6 is `UNKNOWN`. The example explicitly skips that form using `onUnclassified: "skip"`. Omitting that option raises an error.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://www.carsonbank.com/wp-content/uploads/2021/01/Sample-Statement.pdf).
