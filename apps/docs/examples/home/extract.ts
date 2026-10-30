import { Extractor, contract } from "docture/node";
import { LLM } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const Invoice = contract({
  name: "invoice",
  schema: z.object({
    invoiceNumber: z.string(),
    total: z.number(),
  }),
});

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

const result = await extractor.extract(
  "invoice.pdf",
  Invoice,
);
result.data.total; // number
