import { describe, expect, it } from "vitest";
import * as api from "docture";

const raw = { bytes: new TextEncoder().encode("Invoice INV-1"), mimeType: "text/plain" };

describe("readDocument", () => {
  it("runs the first eligible loader and reports which one read the document", async () => {
    const read = await api.readDocument(
      [new api.DocumentLoaderData()],
      raw,
      api.silentLogger,
      new AbortController().signal,
      undefined,
    );

    expect(read.document.text).toBe("Invoice INV-1");
    expect(read.loader.name).toBe("DocumentLoaderData");
    expect(read.attempts.map(({ stage, strategy, status }) => ({ stage, strategy, status }))).toEqual([
      { stage: "load", strategy: "DocumentLoaderData", status: "ok" },
    ]);
  });

  it("reserves the load prefix for builder registration", () => {
    expect("loadDocument" in api).toBe(false);
    expect(typeof new api.Extractor().loadDocumentLoader).toBe("function");
  });
});
