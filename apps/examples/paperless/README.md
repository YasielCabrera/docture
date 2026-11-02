# Read an invoice from Paperless

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Import the adjacent `invoice.pdf` into your Paperless instance and note its document ID. The example downloads that document's original PDF, extracts its invoice number and total, and returns Paperless provenance.

```sh
PAPERLESS_URL=http://localhost:8000 \
PAPERLESS_TOKEN=... \
PAPERLESS_DOCUMENT_ID=42 \
pnpm --filter @docture/examples paperless
```

This requires Paperless API version 10. The script makes read requests only. It does not update fields, tags or notes.

`triggers.ts` contains an optional authenticated webhook handler, bounded demonstration queue and worker. `post-consume.ts` submits a Document Added event from Paperless's post-consume environment. Use a durable queue in a deployed worker; the demonstration queue lives in memory.

[Document sources](../SOURCES.md).
