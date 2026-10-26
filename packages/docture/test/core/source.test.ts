import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  UnsupportedSourceError,
  errorCodeOf,
  resolveSource,
  sniffMimeType,
  type DocumentSource,
} from "../../src/core/index.js";
import { PDF_BYTES, PNG_BYTES } from "./fakes.js";

describe("sniffMimeType", () => {
  it("recognises the formats a document pipeline actually meets", () => {
    expect(sniffMimeType(PDF_BYTES)).toBe("application/pdf");
    expect(sniffMimeType(PNG_BYTES)).toBe("image/png");
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    // Every Office format is a zip; the header cannot tell them apart.
    expect(sniffMimeType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("application/zip");
  });

  it("returns undefined rather than guessing", () => {
    expect(sniffMimeType(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });
});

describe("resolveSource", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "docture-source-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts raw bytes and sniffs the type", async () => {
    const raw = await resolveSource(PDF_BYTES);
    expect(raw.mimeType).toBe("application/pdf");
    expect(raw.bytes).toEqual(PDF_BYTES);
  });

  it("accepts an ArrayBuffer", async () => {
    const raw = await resolveSource(PDF_BYTES.slice().buffer);
    expect(raw.mimeType).toBe("application/pdf");
  });

  it("reads a filesystem path and keeps the file name", async () => {
    const path = join(dir, "statement.pdf");
    await writeFile(path, PDF_BYTES);

    const raw = await resolveSource(path);
    expect(raw.fileName).toBe("statement.pdf");
    expect(raw.mimeType).toBe("application/pdf");
  });

  it("reads a file: URL", async () => {
    const path = join(dir, "via-url.pdf");
    await writeFile(path, PDF_BYTES);

    const raw = await resolveSource(pathToFileURL(path));
    expect(raw.mimeType).toBe("application/pdf");
  });

  it("keeps a custom declared type the library does not know", async () => {
    const raw = await resolveSource({ bytes: PDF_BYTES, mimeType: "application/x-custom" });
    expect(raw.mimeType).toBe("application/x-custom");
  });

  it("lets the file name break the tie for zip-based Office formats", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const raw = await resolveSource({ bytes: zip, fileName: "book.xlsx" });
    expect(raw.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("falls back to the extension when the bytes say nothing", async () => {
    const raw = await resolveSource({ bytes: new Uint8Array([1, 2, 3]), fileName: "notes.txt" });
    expect(raw.mimeType).toBe("text/plain");
  });

  it("rejects an empty document with a typed error", async () => {
    await expect(resolveSource(new Uint8Array())).rejects.toThrowError(UnsupportedSourceError);
  });

  it("rejects a protocol it cannot fetch", async () => {
    await expect(resolveSource("ftp://example.com/a.pdf")).rejects.toThrowError(
      UnsupportedSourceError,
    );
  });

  it("does not mistake a Windows path for a URL", async () => {
    // Would parse as protocol "c:" under a naive `new URL()`.
    await expect(resolveSource("C:\\does\\not\\exist.pdf")).rejects.toThrow(/ENOENT|no such file/i);
  });
});

describe("a source that is not one", () => {
  /**
   * The most ordinary mistake there is: an unset variable, or a promise nobody
   * awaited. Every failure here carries a code, and that has to hold for this one too.
   */
  it("reports a missing source as a typed error, not a TypeError", async () => {
    for (const nothing of [undefined, null]) {
      const error = await resolveSource(nothing as unknown as DocumentSource).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(UnsupportedSourceError);
      expect(errorCodeOf(error)).toBe("UNSUPPORTED_SOURCE");
    }
  });

  it("says so when a loaded document is resolved to bytes by mistake", async () => {
    const error = await resolveSource({
      loaded: { pages: [], text: "", form: "unknown", loader: "x" },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedSourceError);
  });
});
