import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureIo, run } from "../src/index.js";
import { INVOICE_JSON_SCHEMA, cleanup, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

interface Counts {
  load: number;
  extract: number;
  classify: number;
  dispose: number;
  built: number;
}

const counts = (): Counts => (globalThis as unknown as { dryRunCounts: Counts }).dryRunCounts;

beforeEach(() => {
  (globalThis as unknown as { dryRunCounts: Counts }).dryRunCounts = { load: 0, extract: 0, classify: 0, dispose: 0, built: 0 };
});

const COUNTING_CONFIG = `const counts = globalThis.dryRunCounts;
export default {
  loaders: [
    {
      name: "counting",
      capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
      async load() {
        counts.load += 1;
        return { pages: [{ pageNumber: 1, width: 1, height: 1, text: "x" }], text: "x", form: "digital", loader: "counting" };
      },
      async dispose() {
        counts.dispose += 1;
      },
    },
  ],
  strategies: [
    {
      name: "fixed",
      async extract() {
        counts.extract += 1;
        return { data: { invoiceNumber: "INV-1", total: 42 } };
      },
    },
  ],
  classifiers: [
    {
      name: "keyword",
      async classify() {
        counts.classify += 1;
        return { classifier: "keyword", name: "invoice", confidence: 1 };
      },
    },
  ],
  classifications: [{ name: "invoice", description: "a bill", schema: { type: "object" } }],
};
`;

const SUPPLIED_CONFIG = `const counts = globalThis.dryRunCounts;
export default {
  extractor: () => {
    counts.built += 1;
    return {
      async extract() { throw new Error("used"); },
      async *extractBatch() { throw new Error("used"); },
      async classify() { throw new Error("used"); },
      async dispose() { counts.dispose += 1; },
    };
  },
};
`;

async function workspace(config = COUNTING_CONFIG): Promise<string> {
  const cwd = await tempDir("dry-run");
  await writeFixture(cwd, "docture.config.mjs", config);
  await writeFixture(cwd, "schema.json", INVOICE_JSON_SCHEMA);
  await writeFixture(cwd, "invoice.pdf", "%PDF-1.7 pretend");
  await writeFixture(cwd, "invoice.expected.json", JSON.stringify({ invoiceNumber: "INV-1", total: 42 }));
  return cwd;
}

async function dryRun(argv: readonly string[], cwd: string, env: Record<string, string> = {}) {
  let stdinReads = 0;
  const io = captureIo({ cwd, env });
  const guarded = Object.create(io) as typeof io;
  guarded.readStdin = async () => {
    stdinReads += 1;
    throw new Error("stdin was read");
  };
  const code = await run(argv, { io: guarded });
  return { code, stdout: io.stdout, stderr: io.stderr, stdinReads };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe("--dry-run", () => {
  it("plans an extraction without loading, extracting, or writing, and disposes the wiring", async () => {
    const cwd = await workspace();
    const result = await dryRun(["extract", "invoice.pdf", "-s", "schema.json", "-o", "out/", "--dry-run"], cwd);

    expect(result.stderr).not.toContain("error");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: 1,
      command: "extract",
      ok: true,
      results: [{
        file: "invoice.pdf",
        ok: true,
        plan: {
          input: { kind: "path", path: join(cwd, "invoice.pdf") },
          loaders: ["counting"],
          strategies: ["fixed"],
          classifiers: ["keyword"],
          model: null,
          schema: join(cwd, "schema.json"),
          output: { to: "file", path: join(cwd, "out", "invoice.json") },
        },
      }],
      summary: { dryRun: true },
    });
    expect(counts()).toEqual({ load: 0, extract: 0, classify: 0, dispose: 1, built: 0 });
    expect(await exists(join(cwd, "out"))).toBe(false);
  });

  it("reports stdin without reading it", async () => {
    const cwd = await workspace();
    const result = await dryRun(["extract", "-", "-s", "schema.json", "--dry-run"], cwd);

    expect(result.code).toBe(0);
    expect(result.stdinReads).toBe(0);
    expect(JSON.parse(result.stdout).results[0]).toMatchObject({
      file: "stdin",
      plan: { input: { kind: "stdin" }, output: { to: "stdout" } },
    });
  });

  it("plans eval, convert, and classify with no document work", async () => {
    const cwd = await workspace();

    const evaluated = await dryRun(["eval", "invoice.pdf", "-s", "schema.json", "--dry-run"], cwd);
    expect(evaluated.code).toBe(0);
    expect(JSON.parse(evaluated.stdout).results[0].plan).toMatchObject({
      strategies: ["fixed"],
      truth: join(cwd, "invoice.expected.json"),
      output: { to: "stdout" },
    });

    const converted = await dryRun(["convert", "invoice.pdf", "--out", "converted", "--dry-run"], cwd);
    expect(converted.code).toBe(0);
    expect(JSON.parse(converted.stdout)).toMatchObject({
      command: "convert",
      summary: { dryRun: true },
      results: [{
        file: "invoice.pdf",
        plan: {
          loaders: ["counting"],
          layoutAnalyzer: null,
          model: null,
          output: { to: "file", path: join(cwd, "converted", "invoice.md") },
        },
      }],
    });
    expect(await exists(join(cwd, "converted"))).toBe(false);

    const classified = await dryRun(["classify", "invoice.pdf", "--dry-run"], cwd);
    expect(classified.code).toBe(0);
    expect(JSON.parse(classified.stdout).results[0].plan).toMatchObject({
      classifiers: ["keyword"],
      classifications: ["invoice"],
    });

    expect(counts()).toEqual({ load: 0, extract: 0, classify: 0, dispose: 3, built: 0 });
  });

  it("marks a supplied extractor opaque without building it", async () => {
    const cwd = await workspace(SUPPLIED_CONFIG);
    const result = await dryRun(["extract", "invoice.pdf", "-s", "schema.json", "--dry-run"], cwd);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).results[0].plan).toEqual({
      input: { kind: "path", path: join(cwd, "invoice.pdf") },
      opaque: true,
      schema: join(cwd, "schema.json"),
      output: { to: "stdout" },
    });
    expect(counts().built).toBe(0);
  });

  it("keeps exit 2 for a bad schema or a model without credentials", async () => {
    const cwd = await workspace();
    const badSchema = await dryRun(["extract", "invoice.pdf", "-s", "missing.json", "--dry-run"], cwd);
    expect(badSchema.code).toBe(2);
    expect(badSchema.stdout).toBe("");

    const noKey = await dryRun(["extract", "invoice.pdf", "-s", "schema.json", "-m", "openai/test", "--gateway", "--no-config", "--dry-run"], cwd);
    expect(noKey.code).toBe(2);
    expect(noKey.stderr).toContain("AI_GATEWAY_API_KEY");
    expect(counts().load).toBe(0);
  });

  it("names the gateway model it would call", async () => {
    const cwd = await workspace();
    const result = await dryRun(
      ["extract", "invoice.pdf", "-s", "schema.json", "-m", "openai/gpt-5", "--gateway", "--no-config", "--cache", ".cache", "--dry-run"],
      cwd,
      { AI_GATEWAY_API_KEY: "test" },
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).results[0].plan).toMatchObject({
      loaders: ["pdfjs"],
      strategies: ["llm"],
      model: "openai/gpt-5",
    });
    expect(await exists(join(cwd, ".cache"))).toBe(false);
  });
});
