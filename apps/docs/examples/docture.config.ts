import { openai } from "@ai-sdk/openai";
import { defineConfig } from "@docture/cli";
import { llm } from "@docture/llm";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { Invoice } from "./invoice.js";

export default defineConfig({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [llm({ model: openai("gpt-5") })],
  schema: Invoice.schema,
  cacheDir: ".docture-cache",
  concurrency: 4,
});
