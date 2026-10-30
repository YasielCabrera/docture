import { writeFile } from "node:fs/promises";
import { makeInvoicePdf } from "docture/testing/fixtures";

const sample = await makeInvoicePdf({ seed: 301, lineItemCount: 12 });
await writeFile("report.pdf", sample.bytes);
console.log(`Wrote report.pdf for invoice ${sample.expected.invoiceNumber}`);
