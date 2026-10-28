import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Process,
  SplittingStrategy,
  createExtractor,
  defineClassification,
  withRasterizer,
  type Rasterizer,
} from "docture";
import { LLM } from "docture/llm";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { llmClassifier } from "docture/llm/classifier";
import { llmLayout } from "docture/llm/layout";
import { textSplitter } from "docture/llm/split";
import { memoryCache } from "docture/llm/cache";
import { createDocumentConverter } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

interface StartEvent {
  readonly functionId?: string | undefined;
  readonly recordInputs?: boolean | undefined;
  readonly recordOutputs?: boolean | undefined;
  readonly runtimeContext?: Record<string, unknown> | undefined;
}

function recorder() {
  const starts: StartEvent[] = [];
  return {
    starts,
    integration: {
      onStart(event: StartEvent) {
        starts.push({
          functionId: event.functionId, recordInputs: event.recordInputs, recordOutputs: event.recordOutputs,
          runtimeContext: event.runtimeContext,
        });
      },
    },
  };
}

const Total = z.object({ total: z.number() });
const page = "Invoice INV-42 total 60.00 EUR. This document has a complete text layer for a model.";
const source = { bytes: new Uint8Array([1]), fileName: "invoice.pdf" };

function stubRasterizer(): Rasterizer {
  return {
    name: "stub-raster",
    formats: ["png"],
    async rasterize(_document, options) {
      return (options.pages ?? [1]).map((pageNumber) => ({
        pageNumber, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), widthPx: 10, heightPx: 14,
        format: "png" as const, scale: 1,
      }));
    },
  };
}

describe("model telemetry", () => {
  it("tags text extraction with its stage, document, pages and chunk, recording no content", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ total: 60 }]);
    await createExtractor({
      loaders: [inMemoryLoader(loadedDocument([page]))],
      strategies: [llm({ model, telemetry: { integrations: [integration] } })],
    }).extract(source, Total);

    expect(starts).toEqual([{
      functionId: "docture.extract.llm", recordInputs: false, recordOutputs: false,
      runtimeContext: { docture: { stage: "extract", component: "llm", document: "invoice.pdf", pages: [1], chunk: 0 } },
    }]);
  });

  it("keeps explicit recording choices, caller context and suppresses the document label on request", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ total: 60 }]);
    await createExtractor({
      loaders: [inMemoryLoader(loadedDocument([page, page]))],
      strategies: [llm({
        model, completion: "paginate", concurrency: 1,
        telemetry: {
          integrations: [integration], recordInputs: true, recordOutputs: true, documentLabel: false,
          runtimeContext: { tenant: "acme" },
        },
      })],
    }).extract(source, Total);

    expect(starts).toEqual([1, 2].map((pageNumber) => ({
      functionId: "docture.extract.llm", recordInputs: true, recordOutputs: true,
      runtimeContext: {
        tenant: "acme",
        docture: { stage: "extract", component: "llm", pages: [pageNumber], chunk: pageNumber - 1 },
      },
    })));
  });

  it("tags a repair call with the repair stage", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ total: "sixty" }, { total: 60 }]);
    await createExtractor({
      loaders: [inMemoryLoader(loadedDocument([page]))],
      strategies: [llm({ model, telemetry: { integrations: [integration] } })],
    }).extract(source, Total);

    expect(starts.map((start) => start.functionId)).toEqual(["docture.extract.llm", "docture.repair.llm"]);
    expect(starts[1]?.runtimeContext).toEqual({
      docture: { stage: "repair", component: "llm", document: "invoice.pdf", pages: [1] },
    });
  });

  it("makes no provider call event for a cached answer", async () => {
    const { starts, integration } = recorder();
    const cache = memoryCache();
    const { model } = mockModel([{ total: 60 }]);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([page]))],
      strategies: [llm({ model, cache, telemetry: { integrations: [integration] } })],
    });
    await extractor.extract(source, Total);
    await extractor.extract(source, Total);
    expect(starts).toHaveLength(1);
  });

  it("tags vision extraction per page group", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ total: 60 }]);
    await createExtractor({
      loaders: [withRasterizer(inMemoryLoader(loadedDocument(["Scan"])), stubRasterizer())],
      strategies: [vision({ model, telemetry: { integrations: [integration] } })],
    }).extract(source, Total);

    expect(starts).toEqual([{
      functionId: "docture.vision.vision", recordInputs: false, recordOutputs: false,
      runtimeContext: { docture: { stage: "vision", component: "vision", document: "invoice.pdf", pages: [1], chunk: 0 } },
    }]);
  });

  it("tags classification with the document label", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ name: "invoice", confidence: 0.9, reason: "header" }]);
    const invoice = defineClassification({ name: "invoice", description: "An invoice", schema: Total });
    await createExtractor({
      loaders: [inMemoryLoader(loadedDocument([page]))],
      classifiers: [llmClassifier({ model, telemetry: { integrations: [integration] } })],
    }).classify(source, [invoice]);

    expect(starts).toEqual([{
      functionId: "docture.classify.llm-classifier", recordInputs: false, recordOutputs: false,
      runtimeContext: { docture: { stage: "classify", component: "llm-classifier", document: "invoice.pdf", pages: [1] } },
    }]);
  });

  it("tags layout analysis with the analyzed pages", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ annotations: [] }]);
    await createDocumentConverter({
      loaders: [inMemoryLoader(loadedDocument([page]))],
      layoutAnalyzer: llmLayout({ model, telemetry: { integrations: [integration] } }),
    }).convert(source);

    expect(starts.map((start) => start.functionId)).toEqual(["docture.layout.llm-layout"]);
    expect(starts[0]?.runtimeContext).toEqual({ docture: { stage: "layout", component: "llm-layout", pages: [1] } });
  });

  it("tags a splitter seam with both pages and the bundle label", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{
      belongsToSameDocument: true, classificationPage1: "invoice", classificationPage2: "invoice", confidence: 0.9,
    }]);
    const invoice = defineClassification({ name: "invoice", description: "An invoice", schema: Total });
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([page, page]))],
      strategies: [{ name: "fixed", async extract() { return { data: { total: 60 } }; } }],
    });
    await new Process()
      .loadExtractor(extractor)
      .loadSplitter(textSplitter({ model, name: "seams", telemetry: { integrations: [integration] } }))
      .loadFile(source)
      .split([invoice], SplittingStrategy.LAZY)
      .extract();

    expect(starts).toEqual([{
      functionId: "docture.split.seams", recordInputs: false, recordOutputs: false,
      runtimeContext: { docture: { stage: "split", component: "seams", document: "invoice.pdf", pages: [1, 2] } },
    }]);
  });

  it("forwards LLM-wide telemetry to every component it builds", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ total: 60 }]);
    const backend = new LLM(model, { name: "m", telemetry: { integrations: [integration] } });
    await createExtractor({ loaders: [inMemoryLoader(loadedDocument([page]))] })
      .loadLlm(backend)
      .extract(source, Total);
    expect(starts.map((start) => start.functionId)).toEqual(["docture.extract.llm"]);
  });
});
