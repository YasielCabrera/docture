/**
 * `docture` — extraction and document conversion through one import.
 *
 * The packages underneath are split so that installing a pipeline does not install
 * a PDF parser, a WASM OCR engine and a model client you were never going to use.
 * That split is right for the dependency graph and wrong for the first five minutes
 * with the library, which is what this package is for:
 *
 * ```ts
 * import { Extractor, LLM, contract } from "docture";
 * import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
 * import { openai } from "@ai-sdk/openai";
 * import { z } from "zod";
 *
 * const Invoice = contract({
 *   name: "invoice",
 *   description: "A commercial invoice.",
 *   schema: z.object({ invoiceNumber: z.string(), total: z.number() }),
 * });
 *
 * const extractor = new Extractor()
 *   .loadDocumentLoader(new DocumentLoaderPdfJs())
 *   .loadLlm(new LLM(openai("gpt-5")));
 *
 * const result = await extractor.extract("invoice.pdf", Invoice);
 * result.data.total;      // number — inferred, no cast
 * result.usage.costUsd;   // what it cost
 * ```
 *
 * Loaders stay in their own packages on purpose — they are the heavy dependencies,
 * and which one you want is a real decision. Everything else is here.
 */

export * from "@docture/core";
export * from "@docture/llm";
