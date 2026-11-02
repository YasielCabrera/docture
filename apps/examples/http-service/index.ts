import { fileURLToPath } from "node:url";
import { processIo } from "@docture/cli";
import { createHttpService } from "@docture/cli/service";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice, invoiceParser } from "./invoice.js";

export async function runExample(port = 3000) {
  const service = createHttpService({
    io: processIo(),
    host: "127.0.0.1",
    port,
    config: {
      path: fileURLToPath(import.meta.url),
      config: { loaders: [new DocumentLoaderPdfJs()], strategies: [invoiceParser] },
    },
    schemas: { invoice: Invoice },
  });
  await service.start();
  return service;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await runExample();
  console.log(`Docture is listening at ${service.address?.url}. Run client.ts in another terminal.`);
  process.once("SIGINT", () => { void service.close(); });
  process.once("SIGTERM", () => { void service.close(); });
}
