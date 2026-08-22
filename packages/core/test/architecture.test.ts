/**
 * The design rules, enforced.
 *
 * Three claims this library makes are only true as long as something checks them:
 *
 *  1. Installing `@docture/core` pulls no PDF library, no WASM, no ONNX.
 *  2. Dependencies point downward — `domain/` depends on nothing, nothing depends on
 *     `composition/`.
 *  3. The public API is an exact, deliberate list.
 *
 * Each is cheap to break by accident and expensive to discover later, so each is a
 * test rather than a paragraph in a README.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

async function sourceFiles(dir = srcDir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

/**
 * Comments must go before scanning for imports: this codebase's prose regularly
 * contains the word "from" followed by a quoted phrase, and a naive scan reads that
 * as an import of a module called "everything ran and everything failed".
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every module specifier this file imports from. */
function importsOf(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  const patterns = [
    // Anchored to a real import/export statement, not any occurrence of `from`.
    /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

describe("core pulls no document library", () => {
  /**
   * The concrete promise: `pnpm add @docture/core` installs a schema helper and
   * nothing else. Every heavy library lives in the loader package that wraps it, so
   * a deterministic pipeline never pays for pdf.js and a text-only one never pays for
   * ONNX.
   */
  const banned = [
    "pdfjs-dist",
    "mupdf",
    "unpdf",
    "tesseract.js",
    "onnxruntime-node",
    "@napi-rs/canvas",
    "ppu-paddle-ocr",
    "sharp",
    "pdfkit",
    // Not even the AI SDK's runtime package: a model belongs to a strategy.
    "ai",
  ];

  it("declares no heavy dependency in package.json", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const declared = Object.keys(manifest.dependencies ?? {});

    expect(declared).toEqual(["@ai-sdk/provider-utils"]);
    for (const name of banned) expect(declared).not.toContain(name);
  });

  it("imports no heavy dependency anywhere in src", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        if (banned.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
          offenders.push(`${relative(srcDir, file)} imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports only node: builtins and the schema helper", async () => {
    const allowed = new Set(["@ai-sdk/provider-utils"]);
    const offenders: string[] = [];

    for (const file of await sourceFiles()) {
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        const isRelative = specifier.startsWith(".");
        const isNodeBuiltin = specifier.startsWith("node:");
        if (isRelative || isNodeBuiltin || allowed.has(specifier)) continue;
        offenders.push(`${relative(srcDir, file)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("dependencies point downward", () => {
  async function importsWithin(area: string): Promise<{ file: string; target: string }[]> {
    const files = (await sourceFiles()).filter(
      (file) => relative(srcDir, file).split("/")[0] === area,
    );
    const edges: { file: string; target: string }[] = [];
    for (const file of files) {
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        if (specifier.startsWith(".")) {
          edges.push({ file: relative(srcDir, file), target: specifier });
        }
      }
    }
    return edges;
  }

  it("domain/ depends on nothing outside itself", async () => {
    const escaping = (await importsWithin("domain")).filter(
      (edge) => edge.target.startsWith("../") && !edge.target.startsWith("../domain/"),
    );
    expect(escaping).toEqual([]);
  });

  it("nothing imports composition/", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      const name = relative(srcDir, file);
      if (name === "index.ts") continue;
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        if (specifier.includes("composition/")) offenders.push(`${name} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pipeline/ does not import contracts/ implementations it should not know about", async () => {
    // pipeline/ may depend on the CONTRACTS (it orchestrates them) but must not
    // reach into extractor.ts, which is the composition root above it.
    const offenders = (await importsWithin("pipeline")).filter((edge) =>
      edge.target.includes("extractor"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the public API is an exact list", () => {
  /**
   * Widening the surface must be a decision, not a side effect: everything here is
   * something a consumer or a loader author demonstrably needs, and an accidental
   * `export *` would quietly commit us to maintaining an internal helper forever.
   */
  const expected = [
    // entry points
    "Extractor",
    "createExtractor",
    "Process",
    // contracts (named schemas)
    "contract",
    "contractName",
    "isContract",
    "schemaOf",
    // the closed vocabularies
    "ClassificationStrategy",
    "CompletionStrategy",
    "SplittingStrategy",
    // document facts
    "MIN_TEXT_LAYER_CHARS",
    "hasFact",
    "inferForm",
    "isLoadedSource",
    "preloadedFeatures",
    // results
    "EMPTY_USAGE",
    // loaders
    "defineLoader",
    "loaderAccepts",
    "linesFromWords",
    "textFromLines",
    "imageSize",
    "DocumentLoaderData",
    "documentLoaderData",
    // rasterizers + composition
    "withRasterizer",
    "defineRasterizer",
    "DEFAULT_RASTER_OPTIONS",
    // strategies
    "defineStrategy",
    "resolveSchema",
    // classification
    "classificationNode",
    "classificationOf",
    "classificationTree",
    "defineClassification",
    "defineClassifier",
    "extractionContractOf",
    "flattenTree",
    "isClassificationTree",
    // splitting
    "UNCLASSIFIED",
    "aggregateDocGroups",
    "defineSplitter",
    "pageWindows",
    "runSplitter",
    // routing
    "declarationOrder",
    // errors
    "ContractViolationError",
    "DuplicateComponentError",
    "ExtractionFailedError",
    "LoadFailedError",
    "NoEligibleLoaderError",
    "NoEligibleStrategyError",
    "DoctureError",
    "SplitFailedError",
    "TimeoutError",
    "UnclassifiedGroupError",
    "UnsupportedSourceError",
    "errorCodeOf",
    "isAbortError",
    "messageOf",
    // logging
    "consoleLogger",
    "silentLogger",
    // sources
    "resolveSource",
    "sniffMimeType",
    // advanced
    "runPipeline",
    "loadDocument",
  ].sort();

  it("exports exactly the documented runtime values", () => {
    expect(Object.keys(api).sort()).toEqual(expected);
  });
});
