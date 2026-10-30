import { jsonlDataset } from "@docture/eval/node";
import { extractor } from "./extractor.js";
import { Invoice } from "./invoice.js";

const dataset = jsonlDataset("corpus/manifest.jsonl", {
  toExpected: (json) => Invoice.parse(json),
});
try {
  for (const item of await dataset.cases()) {
    const document = item.documents[0];
    if (document === undefined) throw new Error(`${item.id} has no document`);
    const result = await extractor.extract({
      bytes: await document.bytes(),
      mimeType: document.mimeType,
    }, Invoice);
    console.log(`${result.data.invoiceNumber}: ${result.data.totalCents} cents, ${result.usage.totalTokens} model tokens`);
  }
} finally {
  await extractor.dispose();
}
