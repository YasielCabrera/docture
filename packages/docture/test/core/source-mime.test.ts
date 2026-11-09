import { createServer } from "node:http";
import { expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, DocumentLoaderData, loaderAccepts, resolveSource, sniffMimeType } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { fakeLoader, fakeStrategy, PDF_BYTES } from "./fakes.js";

it.each(["text/plain", "application/octet-stream", "image/png", "image/gif", "Application/PDF; charset=binary"])(
  "prefers PDF magic bytes over a generic or conflicting known declaration (%s)", async (mimeType) => {
    expect((await resolveSource({ bytes: PDF_BYTES, mimeType })).mimeType).toBe("application/pdf");
  },
);

it.each(["text/plain", "application/octet-stream"])("prefers PDF magic bytes over HTTP declaration (%s)", async (mimeType) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": mimeType });
    response.end(PDF_BYTES);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
    expect((await resolveSource(`http://127.0.0.1:${address.port}/document`)).mimeType).toBe("application/pdf");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
});

it("preserves deliberate declarations for custom types, ZIP and bytes without magic", async () => {
  const cases = [
    { bytes: PDF_BYTES, mimeType: "application/x-custom" },
    { bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { bytes: new TextEncoder().encode("a,b\n1,2"), mimeType: "text/csv" },
  ];
  const results = await Promise.all(cases.map((source) => resolveSource(source)));
  expect(results.map((source) => source.mimeType)).toEqual([
    "application/x-custom", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/csv",
  ]);
});

it("requires the WEBP marker before overriding a RIFF declaration", async () => {
  const wave = new TextEncoder().encode("RIFF0000WAVE");
  const webp = new TextEncoder().encode("RIFF0000WEBP");
  expect((await resolveSource({ bytes: wave, mimeType: "audio/wav" })).mimeType).toBe("audio/wav");
  expect([sniffMimeType(wave), sniffMimeType(webp)]).toEqual([undefined, "image/webp"]);
});

it("routes PDF bytes declared as plain text to the PDF loader", async () => {
  const loader = fakeLoader({ name: "fake-pdf" });
  const extractor = createExtractor({ loaders: [loader, new DocumentLoaderData()], strategies: [fakeStrategy({ data: { answer: 42 } })] });
  const result = await extractor.extract({ bytes: PDF_BYTES, mimeType: "text/plain" }, z.object({ answer: z.number() }));
  expect({ loader: result.loader, data: result.data }).toEqual({ loader: "fake-pdf", data: { answer: 42 } });
});

it("routes a mixed-case custom declaration to its registered loader", async () => {
  const mimeType = "application/vnd.ms-excel.sheet.macroEnabled.12";
  const bytes = new Uint8Array([0x41, 0x42]);
  expect((await resolveSource({ bytes, mimeType })).mimeType).toBe("application/vnd.ms-excel.sheet.macroenabled.12");
  const extractor = createExtractor({
    loaders: [fakeLoader({ name: "xlsm", mimeTypes: [mimeType] })],
    strategies: [fakeStrategy({ data: { answer: 42 } })],
  });
  const result = await extractor.extract({ bytes, mimeType }, z.object({ answer: z.number() }));
  expect({ loader: result.loader, data: result.data }).toEqual({ loader: "xlsm", data: { answer: 42 } });
});

it("lets the signature and file name decide past a generic or empty declaration", async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const csv = new TextEncoder().encode("a,b\n1,2");
  const cases = [
    { bytes: zip, mimeType: "application/octet-stream", fileName: "report.docx" },
    { bytes: zip, mimeType: "binary/octet-stream", fileName: "sheet.xlsx" },
    { bytes: csv, mimeType: "Application/Octet-Stream", fileName: "rows.csv" },
    { bytes: csv, mimeType: " ", fileName: "rows.csv" },
    { bytes: PDF_BYTES, mimeType: "binary/octet-stream" },
    { bytes: csv, mimeType: "TEXT/CSV" },
  ];
  const results = await Promise.all(cases.map((source) => resolveSource(source)));
  expect(results.map((source) => source.mimeType)).toEqual([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/csv",
    "application/pdf",
    "text/csv",
  ]);
});

it("keeps a declared charset so text decodes in it, falling back to UTF-8 on an unknown label", async () => {
  const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=ISO-8859-1" });
    response.end(latin1);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
    const loader = new DocumentLoaderData();
    const fetched = await resolveSource(`http://127.0.0.1:${address.port}/menu.txt`);
    const declared = await resolveSource({ bytes: latin1, mimeType: 'text/plain; charset="windows-1252"' });
    const unknown = await resolveSource({ bytes: new TextEncoder().encode("Café"), mimeType: "text/plain; charset=no-such-label" });
    const texts = await Promise.all([fetched, declared, unknown].map(async (raw) => (await loader.load(raw)).text));
    expect({ mimeType: fetched.mimeType, texts }).toEqual({ mimeType: "text/plain", texts: ["Café", "Café", "Café"] });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
});

it("keeps the charset a caller sets on a raw document", async () => {
  const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]);
  const raw = await resolveSource({ bytes: latin1, mimeType: "text/plain", charset: "windows-1252" });
  expect({ charset: raw.charset, text: (await new DocumentLoaderData().load(raw)).text })
    .toEqual({ charset: "windows-1252", text: "Café" });
});

it("routes a custom type to its loader whatever the declaration's case", async () => {
  const loader = { ...inMemoryLoader(loadedDocument(["Custom"])), name: "custom", capabilities: { text: true, geometry: false, images: false, mimeTypes: ["application/X-Custom"] } };
  const raw = await resolveSource({ bytes: PDF_BYTES, mimeType: "Application/x-CUSTOM" });
  expect({ mimeType: raw.mimeType, accepted: loaderAccepts(loader, raw.mimeType ?? "") })
    .toEqual({ mimeType: "application/x-custom", accepted: true });
  expect(loaderAccepts({ ...loader, capabilities: { ...loader.capabilities, mimeTypes: ["Text/*"] } }, "text/PLAIN")).toBe(true);
});
