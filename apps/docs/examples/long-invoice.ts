import { openai } from "@ai-sdk/openai";
import { createExtractor } from "@docture/core";
import { fileCache, llm } from "@docture/llm";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
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
