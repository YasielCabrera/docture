import { fileURLToPath } from "node:url";
import { defineEval, exact, number, type EvalExtractor } from "@docture/eval";
import { jsonlDataset } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import { renderScoreboard } from "@docture/eval/reporters/terminal";
import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice } from "./model.js";

export async function runExample(manifest = fileURLToPath(new URL("./output/manifest.jsonl", import.meta.url))) {
  const loader = new DocumentLoaderPdfJs();
  const processor: EvalExtractor = {
    id: "text-layer",
    async extract(item, context) {
      const document = item.documents[0];
      if (!document) throw new Error("The case must contain a PDF.");
      const loaded = await loader.load({ bytes: await document.bytes(), mimeType: document.mimeType }, { signal: context.signal, logger: silentLogger });
      const match = (pattern: RegExp) => pattern.exec(loaded.text)?.[1] ?? null;
      const cents = (pattern: RegExp) => {
        const value = match(pattern);
        return value === null ? null : Math.round(Number(value.replaceAll(",", "")) * 100);
      };
      return { raw: {
        invoiceNumber: match(/Invoice: (INV-\d+)/u),
        customer: match(/Customer: (.+)/u),
        quantity: Number(match(/Quantity: (\d+)/u)) || null,
        unitPriceCents: cents(/Unit price: \$([\d,.]+)/u),
        totalCents: cents(/Total: \$([\d,.]+)/u),
      } };
    },
  };
  return runEval({
    dataset: jsonlDataset(manifest),
    spec: defineEval(Invoice, { strings: exact(), fields: { quantity: number(), unitPriceCents: number(), totalCents: number() } }),
    experiments: processor,
    slices: { rendition: "tags.rendition" },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(renderScoreboard(await runExample()));
