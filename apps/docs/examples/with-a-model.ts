import { openai } from "@ai-sdk/openai";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Extractor } from "docture";
import { LLM } from "docture/llm";
import { fileCache } from "docture/llm/cache";
import { Invoice } from "./invoice.js";

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(
    new LLM(openai("gpt-5"), {
      instructions: "Dates must use YYYY-MM-DD.",
      cache: fileCache(".docture-cache"),
    }),
  );

try {
  const result = await extractor.extract("invoice.pdf", Invoice);
  console.log(result.data, result.usage);
} finally {
  await extractor.dispose();
}
