# Docling import and Office/EPUB service use

Run from this repository:

```sh
pnpm --dir apps/examples exec tsx 18-docling/index.ts
```

The example fetches a real Python-export JSON fixture from a deterministic local
HTTP server, imports it, saves its JSON v2 conversion and native sidecar, chunks
its evidence, and extracts a pressure value. The service path submits DOCX bytes
and explicitly resumes an EPUB job. Two caller schemas produce pressure 100 and
room 42 through deterministic AI SDK provider mocks.

`report.json` and `letter.json` come from the pinned generator in
`packages/docture/test/import/fixtures/generate.py`, using
`docling-core==2.104.0` and native schema 1.10.0. The mock service models
docling-serve 1.38.2's v1 in-body protocol. Mock Office bytes are not real Office
files, and the example does not certify format conversion or a live release.

For a live sidecar, pin your chosen image explicitly and record its deployed
OpenAPI schema. A research candidate is:

```sh
docker run --rm -p 127.0.0.1:5001:5001 ghcr.io/docling-project/docling-serve:v1.38.2
```

This live recipe was not run. No image was pushed and no live model was called.
Check that image's supported platform and deployment options before selecting it.

Use the official TypeScript client for broader job, storage, artifact and native
chunking support. Pass its native DoclingDocument JSON to
`importDoclingDocument()` to keep the same docture schema/evidence workflow.

The saved document and sidecar share the canonical native JSON source digest.
That digest does not identify an original PDF. Physical review requires explicit
original-byte binding and matching page images. Reflowable EPUB text has logical
pages and no invented line boxes. Review still shows its element/cell text and
citation status.
