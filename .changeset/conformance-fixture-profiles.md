---
"docture": minor
---

`docture/testing/conformance` accepts fixture profiles. `describeLoaderConformance` and `describeRasterizerConformance` take `fixtures`, with `pdfFixtures` as the default and `textFixtures` and `pngFixtures` shipped, or a custom `ConformanceFixtures` profile. Checks a profile cannot express, such as page size for text, are reported as skipped. `describeRasterizerConformance` takes `format` to check an advertised output format other than PNG. `DocumentLoaderData` now rejects an already aborted load, and passes the loader suite with `textFixtures`.
