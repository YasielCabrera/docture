import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDocumentConverter, createExtractor } from "docture";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument, fixedStrategy } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const document = () => loadedDocument(["Invoice INV-42 total 12.00 EUR. This document has a complete text layer."]);

describe("attempt diagnostics", () => {
  it("retains Standard Schema array causes, object path keys and root issues", async () => {
    const json = {
      type: "object", properties: { invoiceNumber: { type: "string" } },
      required: ["invoiceNumber"], additionalProperties: false,
    } as const;
    const schema = {
      "~standard": {
        version: 1 as const, vendor: "diagnostic-test",
        jsonSchema: { input: () => json, output: () => json },
        validate(value: unknown) {
          if (typeof value === "object" && value !== null && "invoiceNumber" in value
            && typeof value.invoiceNumber === "string") return { value };
          return { issues: [
            { message: "Expected string", path: [{ key: "invoiceNumber" }] },
            { message: "Indexed issue", path: ["invoices", 0, { key: "invoiceNumber" }] },
            { message: "Root invalid" },
          ] };
        },
      },
    };
    const { model } = mockModel([{ invoiceNumber: 123 }]);
    const result = await createExtractor({
      loaders: [inMemoryLoader(document())],
      strategies: [llm({ model, maxRetries: 0 }), fixedStrategy("fallback", { invoiceNumber: "valid" })],
    }).extract(new Uint8Array([1]), schema);
    expect(result.data).toEqual({ invoiceNumber: "valid" });
    expect(result.attempts[0]?.issues).toEqual([
      { path: "invoiceNumber", message: "Expected string" },
      { path: "invoices.0.invoiceNumber", message: "Indexed issue" },
      { path: "", message: "Root invalid" },
    ]);
  });

  it("records load and extraction stages with raw schema failure details", async () => {
    const { model } = mockModel([{ value: 123 }]);
    const good = inMemoryLoader(document());
    const extractor = createExtractor({
      loaders: [{ ...good, name: "broken", async load() { throw new Error("load failed"); } }, good],
      strategies: [llm({ model }), fixedStrategy("fallback", { value: "recovered" })],
      maxRepairs: 0,
    });
    const result = await extractor.extract(new Uint8Array([1]), z.object({ value: z.string() }));
    expect(result.data).toEqual({ value: "recovered" });
    expect(result.attempts.map((attempt) => attempt.stage)).toEqual(["load", "extract", "extract"]);
    expect(result.attempts[1]).toMatchObject({
      rawOutput: '{"value":123}', finishReason: "stop",
      issues: [{ path: "value", message: "Invalid input: expected string, received number" }],
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    });
  });

  it("keeps contract validation issues as literal fields", async () => {
    const result = await createExtractor({
      loaders: [inMemoryLoader(document())],
      strategies: [fixedStrategy("invalid", { value: 123 }), fixedStrategy("fallback", { value: "ok" })],
    }).extract(new Uint8Array([1]), z.object({ value: z.string() }));
    expect(result.attempts[0]).toMatchObject({
      stage: "extract", errorCode: "CONTRACT_VIOLATION",
      issues: [{ path: "value", message: "Invalid input: expected string, received number" }],
    });
  });

  it("bounds stored raw output to ten thousand JavaScript characters", async () => {
    const raw = JSON.stringify({ value: "x".repeat(12000) });
    const { model } = mockModel([{ value: "x".repeat(12000) }]);
    const result = await createExtractor({
      loaders: [inMemoryLoader(document())],
      strategies: [llm({ model }), fixedStrategy("fallback", { value: 7 })],
    }).extract(new Uint8Array([1]), z.object({ value: z.number() }));
    expect(result.attempts[0]?.rawOutput).toBe(raw.slice(0, 10000));
    expect(result.attempts[0]?.finishReason).toBe("stop");
  });

  it("labels conversion load and layout attempts", async () => {
    const converter = createDocumentConverter({
      loaders: [inMemoryLoader(document())],
      layoutAnalyzer: { name: "broken-layout", async analyze() { throw new Error("layout failed"); } },
    });
    const result = await converter.convert(new Uint8Array([1]));
    expect(result.attempts.map((attempt) => attempt.stage)).toEqual(["load", "layout"]);
    expect(result.attempts[1]).toMatchObject({ strategy: "broken-layout", status: "failed", error: "layout failed" });
  });
});
