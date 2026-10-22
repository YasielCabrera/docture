import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import * as llmApi from "@docture/llm";
import { inMemoryLoader, loadedDocument } from "@docture/testing";
import { mockModel } from "../../llm/test/mock-model.js";
import { captureIo } from "../src/cli/io.js";
import { buildWiring } from "../src/wiring.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

it("CLI gives classifiers the strategy cache and shared model options", async () => {
  const dir = await mkdtemp(join(tmpdir(), "docture-wiring-"));
  directories.push(dir);
  const { model, calls } = mockModel([{ name: "invoice", confidence: 0.9, reason: "Invoice" }, { value: "ok" }]);
  const textStrategy = vi.spyOn(llmApi, "llm");
  const classifier = vi.spyOn(llmApi, "llmClassifier");
  const pricing = { "mock-model": { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 } };
  const wiring = await buildWiring({
    io: captureIo({ cwd: dir }), needsModel: true,
    flags: { classify: true, cacheDir: join(dir, "cache"), temperature: 0.4, instructions: "CLI instructions" },
    config: { path: join(dir, "docture.config.ts"), config: {
      model, pricing,
      loaders: [inMemoryLoader(loadedDocument(["An invoice with more than fifty characters of text, total 60 EUR."]))],
      classifications: [{ name: "invoice", description: "Invoice", schema: z.object({ value: z.string() }) }],
    } },
  });
  try {
    const first = await wiring.extractor.extract(new Uint8Array([1]), z.object({ value: z.string() }));
    await wiring.extractor.extract(new Uint8Array([1]), z.object({ value: z.string() }));
    expect(calls).toHaveLength(2);
    const sharedCache = textStrategy.mock.calls[0]?.[0].cache;
    expect(sharedCache).toBeDefined();
    expect(classifier.mock.calls[0]?.[0].cache).toBe(sharedCache);
    expect(classifier.mock.calls[0]?.[0]).toMatchObject({ pricing, temperature: 0.4, instructions: "CLI instructions" });
    expect(first.usage.costUsd).toBe(250);
    expect(JSON.stringify(calls[0]?.prompt)).toContain("CLI instructions");
  } finally {
    await wiring.dispose();
  }
});

it("CLI shares classifier options when config supplies strategies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "docture-wiring-config-"));
  directories.push(dir);
  const { model, calls } = mockModel([{ name: "invoice", confidence: 0.9, reason: "Invoice" }]);
  const wiring = await buildWiring({
    io: captureIo({ cwd: dir }), needsModel: false,
    flags: { classify: true, cacheDir: join(dir, "cache"), temperature: 0.4, instructions: "CLI instructions" },
    config: { path: join(dir, "docture.config.ts"), config: {
      model, strategies: [{ name: "custom", async extract() { return { data: { value: "ok" } }; } }],
      loaders: [inMemoryLoader(loadedDocument(["An invoice with more than fifty characters of text, total 60 EUR."]))],
      classifications: [{ name: "invoice", description: "Invoice", schema: z.object({ value: z.string() }) }],
    } },
  });
  try {
    await wiring.extractor.classify(new Uint8Array([1]));
    await wiring.extractor.classify(new Uint8Array([1]));
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]?.prompt)).toContain("CLI instructions");
    expect(model.doGenerateCalls[0]?.temperature).toBe(0.4);
  } finally {
    await wiring.dispose();
  }
});
