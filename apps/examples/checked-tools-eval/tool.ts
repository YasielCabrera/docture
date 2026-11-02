import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateText, type LanguageModel } from "ai";
import { createCheckedExtractor } from "docture";
import { extractTool } from "docture/llm/tool";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice, invoiceParser } from "./invoice.js";

export async function runExample(model?: LanguageModel) {
  if (model === undefined && !process.env["AI_GATEWAY_API_KEY"]) throw new Error("Set AI_GATEWAY_API_KEY before running the model tool example.");
  await using extractor = createCheckedExtractor({
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [invoiceParser],
  });
  return await generateText({
    model: model ?? process.env["DOCTURE_MODEL"] ?? "anthropic/claude-sonnet-4.6",
    prompt: "Extract the invoice number and total from invoice.pdf using the extract tool.",
    tools: {
      extract: extractTool({
        extractor,
        contract: Invoice,
        async resolveSource(source) {
          if (source !== "invoice.pdf") throw new Error("Only invoice.pdf is authorized.");
          return { bytes: await readFile(new URL("./invoice.pdf", import.meta.url)), mimeType: "application/pdf" };
        },
      }),
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify((await runExample()).toolResults, null, 2));
}
