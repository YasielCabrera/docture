import { openai } from "@ai-sdk/openai";
import { createExtractor, withRasterizer } from "docture";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { Invoice } from "./invoice.js";

const model = openai("gpt-5");
const loader = withRasterizer(
  new DocumentLoaderPdfJs(),
  new NapiCanvasRasterizer({ dpi: 200 }),
);
const extractor = createExtractor({
  loaders: [loader],
  strategies: [llm({ model }), vision({ model })],
});

try {
  const result = await extractor.extract("scanned-invoice.pdf", Invoice);
  console.log(result.data.total, result.method);
} finally {
  await extractor.dispose();
}
