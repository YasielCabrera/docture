import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, UnsupportedSourceError, resolveSource as portableSource } from "docture";
import { Extractor, DocumentConverter, Process, createExtractor, createDocumentConverter, resolveSource, UnsupportedSourceError as NodeSourceError } from "../../src/node/index.js";

it("Node constructors and factories preserve local source behavior with shared core errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docture-node-source-"));
  try {
    const path = join(directory, "note.txt");
    await writeFile(path, "Portable source text");
    expect(NodeSourceError).toBe(UnsupportedSourceError);
    for (const source of [path, pathToFileURL(path)]) {
      expect((await resolveSource(source)).fileName).toBe("note.txt");
      await expect(portableSource(source)).rejects.toBeInstanceOf(UnsupportedSourceError);
      for (const converter of [new DocumentConverter(), createDocumentConverter()]) {
        converter.loadDocumentLoader(new DocumentLoaderData());
        expect((await converter.convert(source, { format: "text" })).content).toContain("Portable source text");
        await converter.dispose();
      }
      for (const extractor of [new Extractor({ loaders: [new DocumentLoaderData()] }), createExtractor({ loaders: [new DocumentLoaderData()] })]) {
        extractor.loadStrategy({ name: "echo", async extract(ctx) { return { data: { text: ctx.document.text } }; } });
        const schema = z.object({ text: z.string() });
        expect((await extractor.extract(source, schema)).data).toEqual({ text: "Portable source text" });
        const results = await new Process().loadExtractor(extractor).loadFile(source).split([{ name: "note", description: "A text note", schema }]).extract();
        expect(results[0]?.data).toEqual({ text: "Portable source text" });
        await extractor.dispose();
      }
    }
    await expect(resolveSource(new URL("file:///tmp/bad%ZZ"))).rejects.toBeInstanceOf(UnsupportedSourceError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
