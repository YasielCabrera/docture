import { fileURLToPath } from "node:url";
import { gateway, type LanguageModel } from "ai";
import { withRasterizer } from "docture";
import { Extractor } from "docture/node";
import { vision } from "docture/llm/vision";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { MuPdfRasterizer } from "docture/loaders/mupdf";
import { z } from "zod";

export async function extractWithVision(model: LanguageModel) {
  await using extractor = new Extractor({
    loaders: [withRasterizer(new DocumentLoaderPdfJs(), new MuPdfRasterizer())],
    strategies: [vision({ model })],
  });
  return await extractor.extractData(fileURLToPath(new URL("./scanned-statement.pdf", import.meta.url)), z.object({
    accountNumber: z.string(), openingBalance: z.number(), closingBalance: z.number(),
  }), { pages: [1] });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["AI_GATEWAY_API_KEY"]) throw new Error("Set AI_GATEWAY_API_KEY to run vision extraction.");
  const model = gateway(process.env["DOCTURE_MODEL"] ?? "anthropic/claude-sonnet-4.6");
  console.log(JSON.stringify(await extractWithVision(model), null, 2));
}
