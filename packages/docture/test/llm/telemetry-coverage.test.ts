import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDocumentConverter, createExtractor, defineClassification, type LoadedDocument } from "docture";
import { llmClassifier } from "docture/llm/classifier";
import { llmLayout } from "docture/llm/layout";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

interface Start {
  readonly functionId?: string;
  readonly runtimeContext?: Record<string, unknown>;
}

function recorder() {
  const starts: Start[] = [];
  return { starts, integration: { onStart(event: Start) { starts.push(event); } } };
}

function promptText(prompt: unknown): string {
  return JSON.stringify(prompt);
}

const invoice = defineClassification({ name: "invoice", description: "An invoice", schema: z.object({ total: z.number() }) });
const verdict = { name: "invoice", confidence: 0.9, reason: "header" };
const first = "Invoice INV-42 issued by ACME Corp. Page one lists the buyer and the seller.";
const second = "Line items continue here: widgets, gadgets and a long list of services.";
const third = "Payment terms: thirty days. Bank details and the signature close the invoice.";

function renumbered(texts: readonly string[], firstPage: number): LoadedDocument {
  const document = loadedDocument(texts);
  return { ...document, pages: document.pages.map((page, index) => ({ ...page, pageNumber: firstPage + index })) };
}

async function classifyCall(loaded: LoadedDocument, excerptChars: number) {
  const { starts, integration } = recorder();
  const { model, calls } = mockModel([verdict]);
  await createExtractor({
    loaders: [inMemoryLoader(loaded)],
    classifiers: [llmClassifier({ model, excerptChars, telemetry: { integrations: [integration] } })],
  }).classify({ loaded, fileName: "bundle.pdf" }, [invoice]);
  return { context: starts[0]?.runtimeContext, prompt: promptText(calls[0]?.prompt) };
}

describe("layout telemetry", () => {
  const page = "Invoice INV-42 total 60.00 EUR. This document has a complete text layer for a model.";

  it("names the converted source", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ annotations: [] }]);
    await createDocumentConverter({
      loaders: [inMemoryLoader(loadedDocument([page]))],
      layoutAnalyzer: llmLayout({ model, telemetry: { integrations: [integration] } }),
    }).convert({ bytes: new Uint8Array([1]), fileName: "invoice.pdf" });

    expect(starts.map((start) => start.runtimeContext)).toEqual([
      { docture: { stage: "layout", component: "llm-layout", document: "invoice.pdf", pages: [1] } },
    ]);
  });

  it("leaves the source out when documentLabel is false", async () => {
    const { starts, integration } = recorder();
    const { model } = mockModel([{ annotations: [] }]);
    await createDocumentConverter({
      loaders: [inMemoryLoader(loadedDocument([page]))],
      layoutAnalyzer: llmLayout({ model, telemetry: { integrations: [integration], documentLabel: false } }),
    }).convert({ bytes: new Uint8Array([1]), fileName: "invoice.pdf" });

    expect(starts.map((start) => start.runtimeContext)).toEqual([
      { docture: { stage: "layout", component: "llm-layout", pages: [1] } },
    ]);
  });
});

describe("classifier telemetry", () => {
  it("lists only the pages the excerpt reaches, including one it cuts", async () => {
    const { context, prompt } = await classifyCall(loadedDocument([first, second, third]), first.length + 20);

    expect(context).toEqual({
      docture: { stage: "classify", component: "llm-classifier", document: "bundle.pdf", pages: [1, 2] },
    });
    expect(prompt).toContain(second.slice(0, 19));
    expect(prompt).not.toContain(second.slice(0, 20));
    expect(prompt).not.toContain("Payment terms");
  });

  it("lists one page when the excerpt ends inside it", async () => {
    const { context } = await classifyCall(loadedDocument([first, second, third]), 30);

    expect(context).toEqual({
      docture: { stage: "classify", component: "llm-classifier", document: "bundle.pdf", pages: [1] },
    });
  });

  it("does not count a page the excerpt reaches only through the page break", async () => {
    const { context, prompt } = await classifyCall(loadedDocument([first, second, third]), first.length + 1);

    expect(context).toEqual({
      docture: { stage: "classify", component: "llm-classifier", document: "bundle.pdf", pages: [1] },
    });
    expect(prompt).not.toContain("Line items");
  });

  it("reports the original page numbers of a document that starts later", async () => {
    const { context } = await classifyCall(renumbered([first, second, third], 4), 10_000);

    expect(context).toEqual({
      docture: { stage: "classify", component: "llm-classifier", document: "bundle.pdf", pages: [4, 5, 6] },
    });
  });

  it("omits pages when the document text does not come from its pages", async () => {
    const pages = loadedDocument([first, second]);
    const { context, prompt } = await classifyCall({ ...pages, text: "A summary written by the caller about an invoice from ACME Corp for services." }, 4000);

    expect(context).toEqual({ docture: { stage: "classify", component: "llm-classifier", document: "bundle.pdf" } });
    expect(prompt).toContain("A summary written by the caller");
  });
});
