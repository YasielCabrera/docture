import { openai } from "@ai-sdk/openai";
import { createExtractor } from "docture/node";
import { fileCache } from "docture/llm/cache";
import { llm } from "docture/llm/text";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice } from "./invoice.js";

const extractor = createExtractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [
    llm({
      model: openai("gpt-5"),
      completion: "concatenate",
      maxCharsPerRequest: 24_000,
      cache: fileCache(".docture-cache"),
    }),
  ],
});

try {
  const result = await extractor.extract("long-invoice.pdf", Invoice);
  console.log(result.data.lineItems.length, result.usage.totalTokens);
} finally {
  await extractor.dispose();
}
