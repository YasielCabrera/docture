import { expect, it, vi } from "vitest";
import { Extractor, Process, type DocumentLoader } from "docture";

it("disposes a frozen loader shared by a process and its extractor exactly once", async () => {
  const dispose = vi.fn(async () => {});
  const loader = Object.freeze({
    name: "shared",
    capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
    async load() { return { pages: [], text: "", form: "unknown", loader: "shared" }; },
    dispose,
  } satisfies DocumentLoader);
  const extractor = new Extractor({ loaders: [loader] });
  const process = new Process().loadDocumentLoader(loader).loadExtractor(extractor);

  await process.dispose();
  await process.dispose();

  expect(dispose).toHaveBeenCalledTimes(1);
});
