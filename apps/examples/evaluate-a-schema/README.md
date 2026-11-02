# Evaluate invoice extraction

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Score a parser against two adjacent PDFs and their reviewed `.truth.json` files. The same schema defines extraction and evaluation.

```sh
pnpm --filter @docture/examples evaluate
```

The run reads the actual PDFs and checks invoice numbers exactly and totals within half a cent. Both cases should score perfectly and pass the F1 gate. Open `output/report.md` for the saved report.

Replace the parser in `invoice.ts` with your extraction strategy, then rerun against the same documents and truth. Keep truth files independent of parser output so the evaluation can detect mistakes.

[Document sources](../SOURCES.md).
