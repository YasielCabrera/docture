import { fileURLToPath } from "node:url";
import { gateway, type LanguageModel } from "ai";
import { contract } from "docture";
import { Extractor } from "docture/node";
import { llm } from "docture/llm/text";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

export const Invoice = contract({
  name: "supply-invoice",
  description: "A supply invoice with a total and itemized charges.",
  schema: z.object({
    invoiceNumber: z.string(),
    total: z.number(),
    lineItems: z.array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number(), amount: z.number() })),
  }),
});

export async function runExample(model: LanguageModel) {
  await using extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(llm({ model, temperature: 0 }));
  const result = await extractor.extract(fileURLToPath(new URL("./invoice.pdf", import.meta.url)), Invoice);
  return { data: result.data, usage: result.usage, method: result.method };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["AI_GATEWAY_API_KEY"]) throw new Error("Set AI_GATEWAY_API_KEY to run this model example.");
  const model = gateway(process.env["DOCTURE_MODEL"] ?? "anthropic/claude-sonnet-4.6");
  console.log(JSON.stringify(await runExample(model), null, 2));
}
