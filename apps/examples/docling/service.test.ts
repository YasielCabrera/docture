import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { runExample } from "./service.js";

it("submits the local PDF to Docling Serve and imports its response", async () => {
  const invoice = await readFile(new URL("./invoice.pdf", import.meta.url));
  const native: unknown = JSON.parse(await readFile(new URL("./report.json", import.meta.url), "utf8"));
  let submittedPdf = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    submittedPdf = Buffer.concat(chunks).includes(invoice);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "success", document: { json_content: native }, errors: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Docling test server did not bind.");
  try {
    const result = await runExample(`http://127.0.0.1:${address.port}`);
    expect(submittedPdf).toBe(true);
    expect(result.text).toContain("The measured pressure is 100.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
