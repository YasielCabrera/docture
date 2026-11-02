import { fileURLToPath } from "node:url";
import { gateway, type LanguageModel } from "ai";
import { CompletionStrategy, contract } from "docture";
import { Extractor } from "docture/node";
import { llm } from "docture/llm/text";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

const Statement = contract({
  name: "checking-transactions",
  hints: "Extract only rows from TRANSACTIONS. Exclude checks and daily balance summaries.",
  schema: z.object({ transactions: z.array(z.object({ date: z.string(), description: z.string() })) }),
});

export async function extractPages(model: LanguageModel) {
  await using extractor = new Extractor({
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [llm({ model, completion: CompletionStrategy.PAGINATE, concurrency: 1 })],
  });
  return await extractor.extract(fileURLToPath(new URL("./statement.pdf", import.meta.url)), Statement, { pages: [1, 2, 3] });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["AI_GATEWAY_API_KEY"]) throw new Error("Set AI_GATEWAY_API_KEY to run paginated extraction.");
  const model = gateway(process.env["DOCTURE_MODEL"] ?? "anthropic/claude-sonnet-4.6");
  console.log(JSON.stringify(await extractPages(model), null, 2));
}
