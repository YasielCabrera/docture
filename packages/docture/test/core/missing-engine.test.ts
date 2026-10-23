import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ENGINE_RANGES, importEngine } from "../../src/core/engines.js";
import {
  LoadFailedError,
  MissingEngineError,
  createDocumentConverter,
  createExtractor,
  defineStrategy,
  type DocumentLoader,
} from "../../src/core/index.js";
import { PDF_BYTES, doc, fakeLoader } from "./fakes.js";

/**
 * Fixture modules live in a `node_modules` folder outside the workspace, so Node loads
 * them itself and their engine imports fail as they do in an application that never
 * installed those engines.
 */
let root: string;
const url = (name: string) => pathToFileURL(join(root, "node_modules", name)).href;
const requireFromFixtures = (specifier: string) => async () => createRequire(join(root, "node_modules/fixtures/index.cjs"))(specifier);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "docture-missing-engine-"));
  const fixtures = {
    "fixtures/imports-mupdf.mjs": 'import "mupdf";\nexport const loaded = true;\n',
    "fixtures/imports-unknown.mjs": 'import "docture-absent-transitive-dependency";\n',
    "fixtures/fails-to-start.mjs": 'throw new Error("WASM instantiation failed");\n',
    "fake-ocr/package.json": '{ "name": "fake-ocr", "type": "module", "main": "index.js" }\n',
    "fake-ocr/index.js": 'import "onnxruntime-node";\n',
  };
  for (const [name, content] of Object.entries(fixtures)) {
    await mkdir(join(root, "node_modules", name, ".."), { recursive: true });
    await writeFile(join(root, "node_modules", name), content);
  }
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("importEngine", () => {
  it("names an absent engine, its supported range and the entry that needs it", async () => {
    const failure = await importEngine("docture/loaders/mupdf", ["mupdf"], () => import(url("fixtures/imports-mupdf.mjs"))).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MissingEngineError);
    expect(failure).toMatchObject({
      code: "MISSING_ENGINE",
      engine: "mupdf",
      range: "~1.28.0",
      entry: "docture/loaders/mupdf",
      message:
        'docture/loaders/mupdf needs the optional peer mupdf@~1.28.0, which is not installed. ' +
        'Install it beside docture: npm install "mupdf@~1.28.0".',
      cause: { code: "ERR_MODULE_NOT_FOUND" },
    });
  });

  it("names a runtime that an installed engine imports itself", async () => {
    const failure = await importEngine("docture/loaders/paddleocr", ["ppu-paddle-ocr", "onnxruntime-node"], () =>
      import(url("fake-ocr/index.js")),
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "MISSING_ENGINE", engine: "onnxruntime-node", range: "1.27.0", entry: "docture/loaders/paddleocr" });
  });

  it("leaves every other import failure unchanged", async () => {
    const outcomes = await Promise.all([
      importEngine("docture/loaders/mupdf", ["mupdf"], () => import(url("fixtures/imports-unknown.mjs"))),
      importEngine("docture/loaders/mupdf", ["mupdf"], () => import(url("fixtures/missing-file.mjs"))),
      importEngine("docture/loaders/mupdf", ["mupdf"], () => import(url("fixtures/fails-to-start.mjs"))),
      importEngine("docture/loaders/paddleocr", ["onnxruntime-node"], requireFromFixtures("./build/binding.node")),
      importEngine("docture/loaders/pdfjs", ["pdfjs-dist"], () => import(url("fixtures/imports-mupdf.mjs"))),
      importEngine("docture/loaders/pdfjs", ["pdfjs-dist"], () => Promise.reject(new DOMException("stop", "AbortError"))),
    ].map((pending) => pending.then(() => "resolved", (error: unknown) => error)));

    expect(outcomes.map((error) => error instanceof MissingEngineError)).toEqual([false, false, false, false, false, false]);
    expect(outcomes.map((error) => (error instanceof Error ? error.message.split("\n")[0] : error))).toEqual([
      expect.stringMatching(/^Cannot find package 'docture-absent-transitive-dependency' imported from /),
      expect.stringMatching(/^Cannot find module '.*missing-file\.mjs' imported from /),
      "WASM instantiation failed",
      "Cannot find module './build/binding.node'",
      expect.stringMatching(/^Cannot find package 'mupdf' imported from /),
      "stop",
    ]);
  });

  it("returns the engine module when it loads", async () => {
    await expect(importEngine("docture/loaders/pdfjs", ["pdfjs-dist"], async () => ({ version: "6" }))).resolves.toEqual({ version: "6" });
  });
});

describe("loading with an absent engine", () => {
  const Invoice = z.object({ invoice: z.string() });
  const absent = (name: string, engine: "mupdf" | "pdfjs-dist", range: string): DocumentLoader => ({
    name,
    capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
    async load() {
      throw new MissingEngineError(engine, range, `docture/loaders/${name}`);
    },
  });
  const malformed: DocumentLoader = {
    name: "strict",
    capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
    async load() {
      throw new Error("Invalid PDF structure.");
    },
  };
  const strategy = defineStrategy({ name: "echo", async extract(ctx) { return { data: { invoice: ctx.document.text } }; } });

  it("reports the missing engine when no eligible loader could start", async () => {
    const extractor = createExtractor({ loaders: [absent("mupdf", "mupdf", "~1.28.0"), absent("pdfjs", "pdfjs-dist", "^6.2.108")], strategies: [strategy] });
    const converter = createDocumentConverter({ loaders: [absent("mupdf", "mupdf", "~1.28.0")] });

    const failure = await extractor.extract(PDF_BYTES, Invoice).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MissingEngineError);
    expect(failure).toMatchObject({ code: "MISSING_ENGINE", engine: "mupdf", entry: "docture/loaders/mupdf" });
    await expect(converter.convert(PDF_BYTES)).rejects.toMatchObject({ code: "MISSING_ENGINE", engine: "mupdf" });
  });

  it("falls back to a loader whose engine is installed and records the gap", async () => {
    const extractor = createExtractor({ loaders: [absent("mupdf", "mupdf", "~1.28.0"), fakeLoader({ document: doc("INV-9") })], strategies: [strategy] });

    const result = await extractor.extract(PDF_BYTES, Invoice);

    expect(result.data).toEqual({ invoice: "INV-9" });
    expect(result.attempts.map(({ strategy: name, status, errorCode }) => ({ name, status, errorCode }))).toEqual([
      { name: "mupdf", status: "failed", errorCode: "MISSING_ENGINE" },
      { name: "echo", status: "ok", errorCode: undefined },
    ]);
  });

  it("still reports a damaged file when an installed loader read and rejected it", async () => {
    const extractor = createExtractor({ loaders: [absent("mupdf", "mupdf", "~1.28.0"), malformed], strategies: [strategy] });

    const failure = await extractor.extract(PDF_BYTES, Invoice).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LoadFailedError);
    expect(failure).toMatchObject({ code: "LOAD_FAILED" });
    expect(failure instanceof LoadFailedError ? failure.attempts.map(({ strategy: name, errorCode }) => ({ name, errorCode })) : []).toEqual([
      { name: "mupdf", errorCode: "MISSING_ENGINE" },
      { name: "strict", errorCode: undefined },
    ]);
  });
});

describe("engine ranges", () => {
  it("match the optional peer ranges the package declares", async () => {
    const manifest = z
      .object({
        peerDependencies: z.record(z.string(), z.string()),
        peerDependenciesMeta: z.record(z.string(), z.object({ optional: z.boolean().optional() })),
      })
      .parse(JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")));
    const declared = Object.fromEntries(Object.keys(ENGINE_RANGES).map((name) => [name, manifest.peerDependencies[name]]));
    const optional = Object.keys(ENGINE_RANGES).filter((name) => manifest.peerDependenciesMeta[name]?.optional !== true);

    expect(declared).toEqual(ENGINE_RANGES);
    expect(optional).toEqual([]);
  });
});
