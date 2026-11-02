# Import a Docling export

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Import the adjacent `report.json` as a Docture document and split it into retrieval chunks.

```sh
pnpm --filter @docture/examples docling
```

The output includes two pages, laboratory text, chunks and import diagnostics. The input is native Docling JSON because importing that format is the purpose of this example. No service or model is needed. The importer reports that physical highlighting is unavailable without an attested original source.

`service.ts` shows conversion through a real Docling Serve instance using the adjacent `invoice.pdf`.

```sh
DOCLING_URL=http://localhost:5001 pnpm --filter @docture/examples docling-service
```

Start Docling Serve before running that command. The script submits the PDF to your service and prints its converted text and diagnostics.

[PDF sources](../SOURCES.md).
