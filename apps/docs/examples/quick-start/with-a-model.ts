import { openai } from "@ai-sdk/openai";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { LLM } from "docture/llm";
import { Extractor } from "docture/node";
import { Invoice } from "./invoice.js";

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

const result = await extractor.extract("invoice.pdf", Invoice);
console.log(result.data);
console.log(`${result.method} used ${result.usage.totalTokens} model tokens`);
