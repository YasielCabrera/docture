# Test a PDF extraction pipeline

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

`index.ts` extracts two fields from the adjacent `invoice.pdf`. `pipeline.test.ts` checks the values printed on that PDF through the same function an application calls.

```sh
pnpm --filter @docture/examples testing
pnpm --filter @docture/examples exec vitest run testing-your-pipeline/pipeline.test.ts
```

The test requires `INV-2026-0142` and total `717.3`. It runs the actual PDF loader and parser without a model or network request.

`fixtures.ts` demonstrates the fixture generator when a test needs new labelled inputs. It writes a real PDF and its expected data to `output/`.

```sh
pnpm --filter @docture/examples exec tsx testing-your-pipeline/fixtures.ts
```

[Document sources](../SOURCES.md).
