import { openai } from "@ai-sdk/openai";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Extractor } from "docture";
import { LLM } from "docture/llm";
import { Invoice } from "./invoice.js";

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

try {
  const result = await extractor.extract("invoice.pdf", Invoice);

  console.log(result.data.invoiceNumber);
  console.log(result.data.lineItems[0]?.amount);
  console.log(result.method);
} finally {
  await extractor.dispose();
}
