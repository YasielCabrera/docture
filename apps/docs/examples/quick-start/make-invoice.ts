import { writeFile } from "node:fs/promises";
import { makeInvoicePdf } from "docture/testing/fixtures";

const invoice = await makeInvoicePdf({ seed: 7 });
await writeFile("invoice.pdf", invoice.bytes);
console.log(`Wrote invoice.pdf, ${invoice.pageCount} page`);
