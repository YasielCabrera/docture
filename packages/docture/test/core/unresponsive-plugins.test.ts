import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Extractor, type DocumentLoader } from "../../src/core/index.js";
import { doc, fakeLoader } from "./fakes.js";

const schema = z.object({ value: z.string() });
const never = <T>(): Promise<T> => new Promise<T>(() => {});
const stillRunning = (ms: number): Promise<string> =>
  new Promise((resolve) => setTimeout(() => resolve("still running"), ms));

describe("a plugin that ignores its abort signal", () => {
  it("falls back to the next strategy when the stage deadline passes", async () => {
    const extractor = new Extractor({
      loaders: [fakeLoader()],
      strategies: [
        { name: "deaf", extract: never },
        { name: "fallback", async extract() { return { data: { value: "fallback" } }; } },
      ],
    });
    const result = await Promise.race([
      extractor.extract({ loaded: doc("Invoice") }, schema, { stageTimeoutMs: 20 }).then((r) => ({
        data: r.data, attempts: r.attempts.map((a) => [a.strategy, a.status, a.errorCode]),
      })),
      stillRunning(500),
    ]);
    expect(result).toEqual({
      data: { value: "fallback" },
      attempts: [["deaf", "failed", "TIMEOUT"], ["fallback", "ok", undefined]],
    });
  });

  it("moves to the next loader when the load deadline passes", async () => {
    const deaf: DocumentLoader = {
      name: "deaf",
      capabilities: { text: true, geometry: false, images: false, mimeTypes: ["application/pdf"] },
      load: never,
    };
    const extractor = new Extractor({
      loaders: [deaf, fakeLoader({ name: "backup" })],
      strategies: [{ name: "echo", async extract() { return { data: { value: "loaded" } }; } }],
    });
    const result = await Promise.race([
      extractor.extract({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), mimeType: "application/pdf" }, schema, { stageTimeoutMs: 20 })
        .then((r) => ({ loader: r.loader, attempts: r.attempts.map((a) => [a.strategy, a.errorCode]) })),
      stillRunning(500),
    ]);
    expect(result).toEqual({ loader: "backup", attempts: [["deaf", "TIMEOUT"], ["echo", undefined]] });
  });

  it("records a classifier that outlives its deadline as an abstention", async () => {
    const extractor = new Extractor({
      loaders: [fakeLoader()],
      classifiers: [{ name: "deaf", classify: never }],
    });
    const verdict = await Promise.race([
      extractor.classify({ loaded: doc("Invoice") }, [], { stageTimeoutMs: 20 }).then((v) => v.signals),
      stillRunning(500),
    ]);
    expect(verdict).toEqual([{
      classifier: "deaf", name: null, confidence: 0,
      note: 'threw: "classify:deaf" exceeded its 20ms deadline.',
    }]);
  });
});
