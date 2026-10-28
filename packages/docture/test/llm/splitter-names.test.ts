import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Process, SplittingStrategy, createExtractor, defineClassification } from "docture";
import { ImageSplitter, TextSplitter, textSplitter } from "docture/llm/split";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const page = "Invoice INV-42 total 60.00 EUR. This document has a complete text layer for a model.";

describe("model splitter names", () => {
  it("names each concrete splitter by its class and keeps an explicit name", () => {
    const { model } = mockModel([]);

    expect(new TextSplitter({ model }).name).toBe("TextSplitter");
    expect(new ImageSplitter({ model }).name).toBe("ImageSplitter");
    expect(textSplitter({ model, name: "seams" }).name).toBe("seams");
  });

  it("keeps the default name in a subclass", () => {
    class ReceiptSplitter extends TextSplitter {}
    const { model } = mockModel([]);

    expect(new ReceiptSplitter({ model }).name).toBe("TextSplitter");
    expect(new ReceiptSplitter({ model, name: "receipts" }).name).toBe("receipts");
  });

  it("tags split telemetry with the default name", async () => {
    const functionIds: (string | undefined)[] = [];
    const { model } = mockModel([{
      belongsToSameDocument: true, classificationPage1: "invoice", classificationPage2: "invoice", confidence: 0.9,
    }]);
    const integration = { onStart(event: { functionId?: string }) { functionIds.push(event.functionId); } };
    await new Process()
      .loadExtractor(createExtractor({
        loaders: [inMemoryLoader(loadedDocument([page, page]))],
        strategies: [{ name: "fixed", async extract() { return { data: { total: 60 } }; } }],
      }))
      .loadSplitter(textSplitter({ model, telemetry: { integrations: [integration] } }))
      .loadFile({ bytes: new Uint8Array([1]), fileName: "bundle.pdf" })
      .split([defineClassification({ name: "invoice", description: "An invoice", schema: z.object({ total: z.number() }) })],
        SplittingStrategy.LAZY)
      .extract();

    expect(functionIds).toEqual(["docture.split.TextSplitter"]);
  });

  it("keeps the default names in a minified consumer bundle", async () => {
    const output = await build({
      stdin: {
        contents: [
          'import { ImageSplitter, TextSplitter } from "docture/llm/split";',
          "const model = { specificationVersion: \"v3\", provider: \"stub\", modelId: \"stub\" };",
          "export const names = [new TextSplitter({ model }).name, new ImageSplitter({ model }).name];",
        ].join("\n"),
        resolveDir: packageDir,
        loader: "ts",
      },
      bundle: true, minify: true, format: "esm", platform: "node", target: "node22",
      conditions: ["source"], write: false, logLevel: "silent",
    });
    const directory = await mkdtemp(join(tmpdir(), "docture-splitter-names-"));
    try {
      const file = join(directory, "consumer.mjs");
      await writeFile(file, output.outputFiles[0]?.text ?? "");
      const { names } = await import(pathToFileURL(file).href) as { names: string[] };
      expect(names).toEqual(["TextSplitter", "ImageSplitter"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
