# Convert and chunk a statement

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Convert the adjacent six-page `statement.pdf` to Markdown, then make retrieval chunks with page provenance.

```sh
pnpm --filter @docture/examples convert
```

Open `output/statement.md` to inspect the conversion and `output/chunks.json` to inspect chunk text and source pages. The script reads the actual PDF through `DocumentLoaderPdfJs`; it does not construct layout geometry or call a model.

[Document sources](../SOURCES.md).
