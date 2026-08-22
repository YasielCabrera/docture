/**
 * The facade is a re-export, which is exactly why it needs a test.
 *
 * `export * from` two packages resolves a name exported by BOTH by silently omitting
 * it — no error at build time, no error at import time, just a missing export that
 * shows up as `undefined` in someone's code. So the list below is checked, and a
 * document goes through the whole thing end to end.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as api from "../src/index.js";
import {
  CompletionStrategy,
  DocumentLoaderData,
  Extractor,
  LLM,
  Process,
  SplittingStrategy,
  TextSplitter,
  contract,
  type Contract,
} from "../src/index.js";
import { MockLanguageModelV4 } from "ai/test";

/**
 * Every name the documentation tells a reader to import from `docture`.
 *
 * Kept in step with the docs on purpose: a page that shows `import { Process }` and a
 * facade that does not export it is a broken tutorial, and nothing else in the build
 * would catch it.
 */
const DOCUMENTED = [
  // entry points
  "Extractor",
  "Process",
  "createExtractor",
  // contracts
  "contract",
  "contractName",
  "isContract",
  "schemaOf",
  // the closed vocabularies
  "CompletionStrategy",
  "SplittingStrategy",
  "ClassificationStrategy",
  // classification
  "defineClassification",
  "classificationOf",
  "classificationNode",
  "classificationTree",
  "isClassificationTree",
  "flattenTree",
  "extractionContractOf",
  "defineClassifier",
  // splitting
  "defineSplitter",
  "runSplitter",
  "aggregateDocGroups",
  "pageWindows",
  "UNCLASSIFIED",
  // loaders, strategies, composition
  "defineLoader",
  "defineStrategy",
  "withRasterizer",
  "defineRasterizer",
  "DocumentLoaderData",
  "documentLoaderData",
  "loaderAccepts",
  "linesFromWords",
  "textFromLines",
  "imageSize",
  "inferForm",
  "preloadedFeatures",
  "isLoadedSource",
  "loadDocument",
  "resolveSchema",
  "resolveSource",
  "runPipeline",
  "declarationOrder",
  // errors
  "DoctureError",
  "SplitFailedError",
  "UnclassifiedGroupError",
  "ContractViolationError",
  "NoEligibleLoaderError",
  "NoEligibleStrategyError",
  "errorCodeOf",
  // llm
  "LLM",
  "model",
  "LlmStrategy",
  "VisionStrategy",
  "LlmClassifier",
  "TextSplitter",
  "ImageSplitter",
  "textSplitter",
  "imageSplitter",
  "llm",
  "vision",
  "llmClassifier",
  "createLlmExtractor",
  "memoryCache",
  "fileCache",
  "cacheKey",
  "lookupPricing",
  "toUsage",
  "mergePartials",
  "relaxJsonSchema",
  "buildPrompt",
  "estimateTokens",
] as const;

describe("the single import", () => {
  it.each(DOCUMENTED)("exports %s", (name) => {
    expect(api[name as keyof typeof api]).toBeDefined();
  });

  /**
   * The specific hazard: core owns `CompletionStrategy` and `@docture/llm` consumes
   * it. If llm ever re-exports it, this name silently disappears from here.
   */
  it("exports CompletionStrategy despite both packages using it", () => {
    expect(CompletionStrategy.PAGINATE).toBe("paginate");
    expect(SplittingStrategy.EAGER).toBe("eager");
  });

  it("exports the types, not just the values", () => {
    const named: Contract<{ a: string }> = { name: "n", schema: z.object({ a: z.string() }) };
    expect(named.name).toBe("n");
  });
});

describe("end to end, through the facade alone", () => {
  const model = new MockLanguageModelV4({
    modelId: "mock",
    provider: "mock",
    async doGenerate() {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ invoiceNumber: "INV-7" }) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  const Invoice = contract({
    name: "invoice",
    description: "A commercial invoice.",
    schema: z.object({ invoiceNumber: z.string() }),
  });

  it("extracts a document with nothing but `docture` imported", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(model));

    const result = await extractor.extract(
      {
        bytes: new TextEncoder().encode(
          "INVOICE INV-7, issued to somebody, with well over fifty characters of text.",
        ),
        mimeType: "text/plain",
      },
      Invoice,
    );

    expect(result.data.invoiceNumber).toBe("INV-7");
    expect(result.usage.inputTokens).toBe(120);
  });

  it("wires a Process the same way", () => {
    const process = new Process()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadSplitter(new TextSplitter({ model }))
      .loadExtractor(new Extractor().loadDocumentLoader(new DocumentLoaderData()));

    expect(process).toBeInstanceOf(Process);
  });
});
