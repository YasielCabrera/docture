# Read Paperless sources with caller schemas

Run the authenticated local fixture server and deterministic model example.

```sh
pnpm --dir apps/examples exec tsx 21-paperless/index.ts
```

The example reads exact OCR content, iterates a bounded query and extracts from confirmed archived PDF bytes. Content extraction reports uncited fields. Archive extraction uses a separately configured PDF.js loader and verifies fields against positioned lines. It saves matching PDF bytes, source provenance, full extraction and conversion JSON to a printed temporary directory.

The sink example creates an inspectable plan, then simulates a human filling one field. Apply skips that field, fills another, adds a tag and returns an unknown note outcome after a connection failure. An explicit retry reconciles current state and adds one marked note. A further repeat skips existing work. Saved plan and apply results remain available beside the source artifacts.

The example also starts an authenticated local webhook ingress. Duplicate Document Added deliveries enqueue one job. Document Updated events do not enqueue. A worker validates the configured instance and reads fresh source from the Paperless API. The queue in `triggers.ts` is an application-owned, process-local demonstration. Production durability and retention belong to the caller. Importing the module starts no server or queue.

`post-consume.ts` submits `DOCUMENT_ID` to the configured queue ingress and returns after acceptance. It reads `PAPERLESS_INSTANCE`, `PAPERLESS_INGRESS_URL` and `PAPERLESS_INGRESS_TOKEN` from the environment. It does not extract inside the native consumption hook.

Paperless support covers 3.x with REST API 9 and 10. This example models 3.3.4 with API 10. The local token belongs to this mock server. Production credentials come from application configuration. No live server or model is required.

The source adapter uses fetch only. Consumers that select archived PDF evidence install the optional PDF engine explicitly.

```sh
pnpm add docture ai zod pdfjs-dist
```

Paperless already has native AI suggestions and chat. paperless-gpt already offers OCR and custom-field workflows. This example demonstrates docture's caller schemas, evidence status, validation, and reusable source identity.
