import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { runExample } from "./index.js";

afterEach(() => vi.unstubAllEnvs());

it("reads the original Paperless PDF and extracts its printed values", async () => {
  const invoice = await readFile(new URL("./invoice.pdf", import.meta.url));
  const requests: { method: string | undefined; authorization: string | undefined }[] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, authorization: request.headers.authorization });
    response.setHeader("X-Version", "3.3.4");
    response.setHeader("X-Api-Version", "10");
    if (request.url?.includes("download/")) {
      response.setHeader("content-type", "application/pdf");
      response.end(invoice);
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.url?.includes("metadata/")) {
      response.end(JSON.stringify({ has_archive_version: false, original_mime_type: "application/pdf", original_checksum: "original", archive_checksum: null, original_filename: "invoice.pdf", archive_media_filename: null }));
      return;
    }
    response.end(JSON.stringify({
      user_can_change: true, id: 42, root_document: null, title: "Supply invoice", content: "Stored OCR is not the original PDF.",
      tags: [], custom_fields: [], correspondent: null, document_type: null,
      versions: [{ id: 42, is_root: true, checksum: "original", added: "2026-01-01" }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Paperless test server did not bind.");
  vi.stubEnv("PAPERLESS_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("PAPERLESS_TOKEN", "test-token");
  vi.stubEnv("PAPERLESS_DOCUMENT_ID", "42");
  try {
    const result = await runExample();
    expect(result.data).toEqual({ invoiceNumber: "INV-2026-0142", total: 717.3 });
    expect(result.provenance).toMatchObject({ documentId: 42, fileVersionId: 42, variant: "original" });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.method === "GET" && request.authorization === "Token test-token")).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
