import { openai } from "@ai-sdk/openai";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Extractor, type DocumentSource } from "docture";
import { LLM } from "docture/llm";
import { Invoice } from "./invoice.js";

const files: readonly DocumentSource[] = ["invoice-1.pdf", "invoice-2.pdf"];
const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

try {
  for await (const item of extractor.extractBatch(files, Invoice, { concurrency: 4 })) {
    if (item.outcome.ok) {
      console.log(item.index, item.outcome.result.data.invoiceNumber);
    } else {
      console.error(item.index, item.outcome.error.message);
    }
  }
} finally {
  await extractor.dispose();
}
