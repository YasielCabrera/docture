import { openai } from "@ai-sdk/openai";
import { Extractor, defineStrategy, type RoutingPolicy } from "docture";
import { llm } from "docture/llm/text";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice } from "./invoice.js";

const knownLayout = defineStrategy({
  name: "known-layout",
  requires: ["TEXT_LAYER"],
  async extract({ document }) {
    const match = /Invoice Number:\s*(\S+)/.exec(document.text);
    if (match?.[1] === undefined) throw new Error("known layout not found");
    return { data: { invoiceNumber: match[1] } };
  },
});

const shortestFirst: RoutingPolicy = (features, eligible) =>
  features.pageCount <= 2 ? eligible : [...eligible].reverse();

const extractor = new Extractor({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [knownLayout, llm({ model: openai("gpt-5") })],
  policy: shortestFirst,
});

try {
  const result = await extractor.extract("invoice.pdf", Invoice);
  console.log(result.method, result.attempts);
} finally {
  await extractor.dispose();
}
