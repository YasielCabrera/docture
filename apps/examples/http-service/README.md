# Serve PDF extraction over HTTP

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Start the service with its PDF loader, schema and deterministic invoice parser.

```sh
pnpm --filter @docture/examples service
```

In another terminal, send the adjacent `invoice.pdf` to the service.

```sh
pnpm --filter @docture/examples service-client
```

The response contains `INV-2026-0142` and total `717.3`. The service binds to `127.0.0.1:3000`; press Ctrl-C to close it. `example.test.ts` starts the same service on an available port and checks the real PDF response.

[Document sources](../SOURCES.md).
