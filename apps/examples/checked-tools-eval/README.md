# Check extractor capabilities

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Wire a PDF loader and a strategy requiring `TEXT_LAYER`, then extract the invoice number and total from the adjacent `invoice.pdf`.

```sh
pnpm --filter @docture/examples checked-tools-eval
```

`createCheckedExtractor` checks whether literal loader capabilities can satisfy the strategy at compile time. The document's actual facts and schema remain runtime checks.

`tool.ts` exposes the same extraction as an AI SDK tool. Its resolver authorizes only the bundled invoice; the model cannot choose another filesystem path.

```sh
AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples model-tool
```

Set `DOCTURE_MODEL` to change the AI Gateway model. This command makes a paid model request. `tool.test.ts` runs the actual tool against the PDF with deterministic provider responses.

[Document sources](../SOURCES.md).
