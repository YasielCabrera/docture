import type { DocumentLoader, LoadedPage, StrategyContext } from "docture";
import { describe, expect, it } from "vitest";
import { inspectProbe } from "../src/operations.js";
import { pageRenderer } from "../src/review/pages.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function cancellingPage(controller: AbortController, seen: (AbortSignal | undefined)[]): LoadedPage {
  return {
    pageNumber: 1,
    width: 600,
    height: 800,
    text: "Hello",
    image: async (_opts, call) => {
      seen.push(call?.signal);
      controller.abort(new DOMException("stopped by caller", "AbortError"));
      call?.signal?.throwIfAborted();
      return PNG;
    },
  };
}

describe("page renders follow the caller's signal", () => {
  it("review stops rendering when the caller cancels mid-render", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const loader: DocumentLoader = {
      name: "rendering",
      capabilities: { text: true, geometry: true, images: true, mimeTypes: ["*/*"] },
      async load() {
        return { pages: [cancellingPage(controller, seen)], text: "Hello", form: "digital", loader: "rendering" };
      },
    };
    const renderer = await pageRenderer({
      config: { config: { loaders: [loader] }, path: "/virtual/docture.config.ts" },
      dpi: 72,
    });

    await expect(
      renderer.render({ bytes: PNG, mimeType: "image/png", fileName: "page.png" }, controller.signal),
    ).rejects.toThrow("stopped by caller");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(true);
  });

  it("inspect reports a cancelled render as a cancellation, not as a render error", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const page = cancellingPage(controller, seen);
    const ctx = {
      document: { pages: [page], text: "Hello", form: "digital", loader: "rendering" },
      features: {},
      signal: controller.signal,
    } as unknown as StrategyContext;

    await expect(inspectProbe({ text: false, lines: false, render: true }).extract(ctx)).rejects.toThrow(
      "stopped by caller",
    );
    expect(seen[0]?.aborted).toBe(true);
  });
});
