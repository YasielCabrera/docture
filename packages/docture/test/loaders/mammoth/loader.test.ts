import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DocumentConverter, errorCodeOf, silentLogger } from "docture";
import { DocumentLoaderMammoth } from "../../../src/loaders/mammoth/index.js";
import { describeLoaderConformance } from "docture/testing/conformance";

const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const context = () => ({ signal: new AbortController().signal, logger: silentLogger });
const fixture = async () => ({ bytes: new Uint8Array(await readFile(new URL("./fixtures/heading-paragraph-table.docx", import.meta.url))), mimeType });

describe("DOCX raw-text loading", () => {
  it("preserves heading, paragraph and table text in source order on one logical page", async () => {
    const loader = new DocumentLoaderMammoth();
    expect(loader.capabilities).toEqual({ text: true, geometry: false, images: false, mimeTypes: [mimeType] });
    const document = await loader.load(await fixture(), context());
    expect(document.text).toBe("Quarterly report\n\nRevenue grew this quarter.\n\nRegion\n\nRevenue\n\nNorth\n\n42\n\n");
    expect(document.pages).toEqual([{ pageNumber: 1, width: 0, height: 0, text: document.text }]);
    expect(document.meta).toMatchObject({ pagination: "logical", pagesRead: 1 });
    const converted = await new DocumentConverter({ loaders: [loader] }).convert(await fixture(), { format: "text" });
    expect(converted.content).toContain("Quarterly report");
    expect(converted.content.indexOf("Revenue grew")).toBeLessThan(converted.content.indexOf("North"));
  });

  it("validates the single logical page selection", async () => {
    const loader = new DocumentLoaderMammoth();
    const raw = await fixture();
    expect((await loader.load(raw, { ...context(), request: { pages: [1] } })).pages.map((page) => page.pageNumber)).toEqual([1]);
    const failure: unknown = await loader.load(raw, { ...context(), request: { pages: [2] } }).catch((error: unknown) => error);
    expect(errorCodeOf(failure)).toBe("PAGE_OUT_OF_RANGE");
  });

  it.each([new Uint8Array([1, 2, 3]), new TextEncoder().encode("PK not a DOCX")])("rejects malformed DOCX with a typed failure", async (bytes) => {
    const failure: unknown = await new DocumentLoaderMammoth().load({ bytes, mimeType }, context()).catch((error: unknown) => error);
    expect(errorCodeOf(failure)).toBe("LOAD_FAILED");
    expect(failure).toMatchObject({ message: expect.stringContaining("DOCX"), cause: expect.anything() });
  });

  it("checks cancellation before engine work", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel DOCX");
    controller.abort(reason);
    await expect(new DocumentLoaderMammoth().load(await fixture(), { signal: controller.signal, logger: silentLogger })).rejects.toBe(reason);
  });

  it("rejects an otherwise valid ZIP without Word document parts", async () => {
    const bytes = new Uint8Array(await readFile(new URL("./fixtures/not-docx.zip", import.meta.url)));
    const failure: unknown = await new DocumentLoaderMammoth().load({ bytes, mimeType }, context()).catch((error: unknown) => error);
    expect(errorCodeOf(failure)).toBe("LOAD_FAILED");
  });
});

describeLoaderConformance({
  name: "DocumentLoaderMammoth",
  create: () => new DocumentLoaderMammoth(),
  fixtures: {
    mimeType,
    dimensions: false,
    async document(seed) {
      const second = seed % 2 === 0;
      const bytes = new Uint8Array(await readFile(new URL(second ? "./fixtures/second-report.docx" : "./fixtures/heading-paragraph-table.docx", import.meta.url)));
      return { bytes, mimeType, expectedText: [second ? "Second DOCX report" : "Quarterly report"], pageCount: 1, form: "digital" };
    },
    invalid: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType }),
  },
});
