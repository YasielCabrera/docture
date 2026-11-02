# Read a PDF once

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Load `invoice.pdf` with PDF.js, then pass the loaded source to an extractor. This is useful when several operations share the same document.

```sh
pnpm --filter @docture/examples internals
```

The result contains `INV-2026-0142`, total `717.3`, and one page. `invoice.ts` contains the schema and the layout-specific parser. The extractor keeps a loader configured, but extraction from the loaded source does not read the PDF again.

[Document sources](../SOURCES.md).
