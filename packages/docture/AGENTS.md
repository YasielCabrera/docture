# Using docture

Read this file explicitly when working on an application that imports docture.
For example, a Codex task can read `node_modules/docture/AGENTS.md` before editing
its extraction pipeline. Automatic dependency-guide discovery is not assumed.

Install the schema peer used by the example with `npm install docture zod@4.4.3`.

The package has per-file ESM and explicit capability entries. Import only the
capabilities the application uses. The root is portable and contains core only.
Use `docture/node` for local file paths and file URLs. Bytes, HTTP URLs and loaded
sources work through the portable root. File access never registers globally.

```ts
import { Extractor, DocumentLoaderData } from "docture";
import { z } from "zod";

const extractor = new Extractor({
  loaders: [new DocumentLoaderData()],
  strategies: [{
    name: "text",
    async extract(context) { return { data: { text: context.document.text } }; },
  }],
});
const schema = z.object({ text: z.string() });
try {
  const result = await extractor.extract({
    bytes: new TextEncoder().encode("Hello"), mimeType: "text/plain",
  }, schema);
  console.log(result.data.text);
} finally {
  await extractor.dispose();
}
```

Use `readDocument` to try a caller-selected ordered loader list without extraction.
Use a `LoadedSource` to reuse an already-read document. It bypasses loaders.
Keep source identities and citation evidence with saved extraction results.
Element and table-cell evidence is not positioned line evidence.

Install optional engines explicitly beside the application. For PDF text:

```sh
npm install docture pdfjs-dist@6.2.108
```

Then import `DocumentLoaderPdfJs` from `docture/loaders/pdfjs`.
LLM text, vision and tools have separate `docture/llm/...` entries.
OCR engines, DOCX, email, service sources and write-back are separate opt-ins.
Importing a service adapter does not contact its service.

Dispose resources after their final use. Share a `createDisposalScope()` when
several pipelines own the same loader or rasterizer. Do not mutate a loader's
dispose method. The extraction tool borrows its caller's extractor.

Inspect `errorCodeOf(error)` or `isDoctureError(error)` for typed failures.
Use `MissingEngineError` install advice. Error constructor names and plain code
strings do not establish identity across installed copies.

See the documentation's [/llms.txt](http://localhost:3100/llms.txt) route when running the docs locally for the current page index and the
troubleshooting guide for verified symptoms. Prefer deterministic provider mocks
for local tests. State separately which live integrations were exercised.
