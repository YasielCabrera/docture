/**
 * `DocumentLoaderData` — the loader that wraps no library.
 *
 * It earns its place in core by having no dependency: plain text, Markdown, CSV and
 * JSON are bytes plus a `TextDecoder`, so `@docture/core` on its own is a working
 * extraction pipeline for the documents that were never PDFs.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, Extractor, documentLoaderData, loaderAccepts } from "../src/index.js";
import { fakeStrategy } from "./fakes.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("DocumentLoaderData", () => {
  it("reads text into a single page", async () => {
    const document = await new DocumentLoaderData().load(
      { bytes: bytes("hello world"), mimeType: "text/plain" });
    expect(document.pages).toHaveLength(1);
    expect(document.text).toBe("hello world");
    expect(document.pages[0]?.text).toBe("hello world");
  });

  /** Form feed is what this library joins pages WITH, so a round trip must survive. */
  it("splits on the form feed by default, so a round trip preserves pages", async () => {
    const document = await new DocumentLoaderData().load(
      { bytes: bytes("page one\fpage two\fpage three") });
    expect(document.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(document.pages[1]?.text).toBe("page two");
  });

  it("takes a custom delimiter", async () => {
    const document = await new DocumentLoaderData({ pageDelimiter: "\n---\n" }).load(
      { bytes: bytes("a\n---\nb") });
    expect(document.pages).toHaveLength(2);
  });

  it("reports the digital/scanned verdict honestly", async () => {
    const empty = await new DocumentLoaderData().load({ bytes: bytes("   ") });
    expect(empty.form).toBe("scanned");

    const real = await new DocumentLoaderData().load(
      { bytes: bytes("a real page of text, comfortably over the threshold for a text layer") });
    expect(real.form).toBe("digital");
  });

  /** Inventing US Letter would be a lie a geometry consumer could act on. */
  it("reports no page size rather than a made-up one", async () => {
    const document = await new DocumentLoaderData().load({ bytes: bytes("x") });
    expect(document.pages[0]?.width).toBe(0);
    expect(document.pages[0]?.height).toBe(0);
  });

  it("declares text but neither geometry nor images", () => {
    const loader = new DocumentLoaderData();
    expect(loader.capabilities).toMatchObject({ text: true, geometry: false, images: false });
  });

  it("accepts the text family, and not a PDF", () => {
    const loader = new DocumentLoaderData();
    expect(loaderAccepts(loader, "text/plain")).toBe(true);
    expect(loaderAccepts(loader, "text/markdown")).toBe(true);
    expect(loaderAccepts(loader, "application/json")).toBe(true);
    expect(loaderAccepts(loader, "application/pdf")).toBe(false);
  });

  it("takes extra media types", () => {
    const loader = new DocumentLoaderData({ mimeTypes: ["application/x-ndjson"] });
    expect(loaderAccepts(loader, "application/x-ndjson")).toBe(true);
  });

  it("takes a custom name, so two can be wired at once", () => {
    expect(new DocumentLoaderData({ name: "markdown" }).name).toBe("markdown");
    expect(documentLoaderData().name).toBe("DocumentLoaderData");
  });

  it("works as the only loader in a pipeline", async () => {
    const result = await new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadStrategy(fakeStrategy({ data: { value: "parsed" } }))
      .extract(
        { bytes: bytes("a plain text document with well over fifty characters in it"), mimeType: "text/plain" },
        z.object({ value: z.string() }),
      );

    expect(result.data.value).toBe("parsed");
    expect(result.loader).toBe("DocumentLoaderData");
  });
});
