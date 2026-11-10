# Using docture

Read this file explicitly when working on an application that imports docture.
For example, a Codex task can read `node_modules/docture/AGENTS.md` before editing
its extraction pipeline. Automatic dependency-guide discovery is not assumed.

Install the schema peer used by the example with `npm install docture zod`.

The package has per-file ESM and explicit capability entries. Import only the
capabilities the application uses. The root is portable and contains core only.
Use `docture/node` for local file paths and file URLs. Bytes, HTTP URLs and loaded
sources work through the portable root. File access never registers globally.

This pipeline runs without a model or credentials, so it also works as a test
double. Its inline strategy stands in for a model:

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

To extract with a model, wrap an AI SDK model in `LLM` and pass it to `loadLlm`.
This is the usual first pipeline for a PDF:

```sh
npm install docture pdfjs-dist ai @ai-sdk/openai zod
```

```ts
import { Extractor } from "docture/node";
import { LLM } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const Invoice = z.object({ invoiceNumber: z.string(), total: z.number() });

await using extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));
const result = await extractor.extract("invoice.pdf", Invoice);
console.log(result.data, result.method, result.usage.totalTokens);
```

Configure vision and classification in that one `loadLlm` call. A second
`loadLlm` call with the same model throws `DUPLICATE_COMPONENT`.
`llm({ model })` with `loadStrategy` and `createLlmExtractor` are alternatives
for per-strategy settings and one-call setup.

Use `readDocument` to try a caller-selected ordered loader list without extraction.
Use a `LoadedSource` to reuse an already-read document. It bypasses loaders.
Keep source identities and citation evidence with saved extraction results.
Element and table-cell evidence is not positioned line evidence.

Install optional engines explicitly beside the application. For PDF text:

```sh
npm install docture pdfjs-dist
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

## Further reading

`node_modules/docture/README.md` ships beside this file. Its Usage, Models,
Fallback and errors, Error codes, and Packages and imports sections cover the
public API of this installed version.

The complete documentation for all four packages ships once in
`node_modules/docture/docs/`. Start with `llms-tasks.txt` for a task,
`llms.txt` for the page index, or `api-symbols.json` for a symbol. Read individual
Markdown files as needed. Internal links work offline.

From the consuming workspace package, locate the installed copy without loading
the runtime:

```sh
node --input-type=module -e 'console.log(import.meta.resolve("docture/docs/manifest.json"))'
```

Read files relative to that manifest, not a guessed path through `.pnpm`.
Its `packages` field records the exact versions documented for all four packages.
Check those versions against the application's installed packages before using
package-specific APIs. `releaseStatus: "unreleased"` identifies a development
snapshot. Prefer installed docs over the repository's moving main branch.
`resources/troubleshooting.md` covers symptoms and `resources/errors.md` covers
error codes.

Prefer deterministic provider mocks for local tests. State separately which live
integrations were exercised.
