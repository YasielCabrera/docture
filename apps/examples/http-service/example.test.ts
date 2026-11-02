import { expect, it } from "vitest";
import { runExample as startService } from "./index.js";
import { runExample as extractInvoice } from "./client.js";

it("extracts the local PDF through the HTTP client and server", async () => {
  const service = await startService(0);
  try {
    expect(await extractInvoice(service.address?.url)).toMatchObject({
      ok: true,
      results: [{ ok: true, data: { invoiceNumber: "INV-2026-0142", total: 717.3 } }],
    });
  } finally {
    await service.close();
  }
});
