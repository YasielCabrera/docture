import { fileURLToPath } from "node:url";
import { defineLoader, defineStrategy } from "docture";
import { Extractor } from "docture/node";
import { z } from "zod";

const csvLoader = defineLoader({
  name: "csv",
  capabilities: { text: true, geometry: false, images: false, mimeTypes: ["text/csv"] },
  async load(raw) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes);
    return { loader: "csv", form: "digital", text, pages: [{ pageNumber: 1, width: 612, height: 792, text }] };
  },
});

export async function runExample() {
  await using extractor = new Extractor({
    loaders: [csvLoader],
    strategies: [defineStrategy({
      name: "item-csv",
      requires: ["TEXT_LAYER"],
      async extract({ document }) {
        const lineItems = document.text.trim().split("\n").slice(1).map((line) => {
          const [sku, quantity, amount] = line.split(",");
          return { sku, quantity: Number(quantity), amount: Number(amount) };
        });
        return { data: { lineItems } };
      },
    })],
  });
  return await extractor.extractData(fileURLToPath(new URL("./items.csv", import.meta.url)), z.object({
    lineItems: z.array(z.object({ sku: z.string(), quantity: z.number(), amount: z.number() })),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
