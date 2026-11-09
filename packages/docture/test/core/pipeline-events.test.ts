import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DocumentConverter,
  Extractor,
  defineClassification,
  silentLogger,
  type Logger,
  type PipelineEvent,
} from "../../src/core/index.js";
import { fakeClassifier, fakeLoader, fakeStrategy, multiPageDoc, PDF_BYTES } from "./fakes.js";

const schema = z.object({ value: z.string() });
const pdf = { bytes: PDF_BYTES, mimeType: "application/pdf" };

function extractor(): Extractor {
  return new Extractor({
    loaders: [fakeLoader({ name: "broken", fail: "corrupt" }), fakeLoader({ document: multiPageDoc(["Invoice", "Total 60"]) })],
    strategies: [
      fakeStrategy({ name: "bad", fail: "model offline", needsClassification: "hint" }),
      fakeStrategy({ name: "good", data: { value: "ok" } }),
    ],
    classifiers: [fakeClassifier("fixed", { classifier: "fixed", name: "invoice", confidence: 0.9 })],
    classifications: [defineClassification({ name: "invoice", description: "an invoice", schema })],
  });
}

const timeless = (event: PipelineEvent) =>
  event.type === "load" ? { ...event, ms: typeof event.ms }
    : event.type === "attempt" ? { type: event.type, attempt: { ...event.attempt, ms: typeof event.attempt.ms } }
      : event;

describe("onEvent", () => {
  it("reports load, classify and each attempt of an extraction in order", async () => {
    const events: PipelineEvent[] = [];
    const result = await extractor().extract(pdf, schema, { onEvent: (event) => events.push(event) });
    expect(events.map(timeless)).toEqual([
      { type: "attempt", attempt: { stage: "load", strategy: "broken", status: "failed", ms: "number", error: "corrupt" } },
      { type: "load", loader: "fake", pages: 2, ms: "number" },
      { type: "classify", result: { name: "invoice", confidence: 0.9, signals: [{ classifier: "fixed", name: "invoice", confidence: 0.9 }] } },
      { type: "attempt", attempt: { stage: "extract", strategy: "bad", status: "failed", ms: "number", error: "model offline" } },
      { type: "attempt", attempt: { stage: "extract", strategy: "good", status: "ok", ms: "number" } },
    ]);
    const attempted = events.flatMap((event) => event.type === "attempt" ? [event.attempt] : []);
    expect(attempted.every((attempt, index) => attempt === result.attempts[index])).toBe(true);
    expect(attempted).toHaveLength(result.attempts.length);
  });

  it("reports the load and verdict of classify", async () => {
    const events: string[] = [];
    await extractor().classify(pdf, undefined, { onEvent: (event) => events.push(event.type) });
    expect(events).toEqual(["attempt", "load", "classify"]);
  });

  it("logs a listener that throws and keeps extracting", async () => {
    const warnings: unknown[] = [];
    const logger: Logger = { ...silentLogger, warn: (msg, fields) => warnings.push([msg, fields]), child: () => logger };
    const result = await extractor().extract(pdf, schema, {
      logger,
      onEvent: (event) => { if (event.type === "load") throw new Error("progress bar broke"); },
    });
    expect(result.data).toEqual({ value: "ok" });
    expect(warnings).toContainEqual(["onEvent listener threw", { event: "load", error: "progress bar broke" }]);
  });

  it("logs an async listener that rejects without an unhandled rejection or waiting for it", async () => {
    const warnings: unknown[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const logger: Logger = {
      ...silentLogger,
      warn: (msg, fields) => { if (msg.startsWith("onEvent")) warnings.push([msg, fields]); },
      child: () => logger,
    };
    let rejectLoad: (error: Error) => void = () => {};
    try {
      const result = await extractor().extract(pdf, schema, {
        logger,
        onEvent: (event) => event.type === "load" ? new Promise<void>((_resolve, reject) => { rejectLoad = reject; }) : undefined,
      });
      expect(result.data).toEqual({ value: "ok" });
      expect(warnings).toEqual([]);
      rejectLoad(new Error("progress socket closed"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([["onEvent listener threw", { event: "load", error: "progress socket closed" }]]);
  });

  it("reports load, attempts and each analyzed page of a conversion", async () => {
    const events: PipelineEvent[] = [];
    const converter = new DocumentConverter({ loaders: [fakeLoader({ document: multiPageDoc(["Alpha", "Beta"]) })] });
    const result = await converter.convert(pdf, { onEvent: (event) => events.push(event) });
    expect(events.map(timeless)).toEqual([
      { type: "attempt", attempt: { stage: "load", strategy: "fake", status: "ok", ms: "number" } },
      { type: "load", loader: "fake", pages: 2, ms: "number" },
      { type: "page", pageNumber: 1, done: 1, total: 2 },
      { type: "page", pageNumber: 2, done: 2, total: 2 },
    ]);
    expect(events[0]?.type === "attempt" ? events[0].attempt : undefined).toBe(result.attempts[0]);
  });
});
