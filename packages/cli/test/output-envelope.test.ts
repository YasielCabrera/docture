import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CliError, UsageError, explain } from "../src/cli/errors.js";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const CONFIG = `import { jsonSchema } from "ai";
export default {
  concurrency: 1,
  schema: jsonSchema({ type: "object" }),
  classifications: [{ name: "invoice", description: "invoice", schema: jsonSchema({ type: "object" }) }],
  loaders: [{
    name: "fake",
    capabilities: { text: true, geometry: true, images: false, mimeTypes: ["*/*"] },
    async load(raw) {
      if (raw.fileName.startsWith("bad")) throw new Error("broken document");
      return { loader: "fake", form: "digital", text: "Invoice", pages: [{
        pageNumber: 1, width: 600, height: 800, text: "Invoice",
        lines: [{ y: 10, height: 12, text: "Invoice", spans: [
          { text: "Invoice", x: 10, y: 10, width: 42, height: 12 }
        ] }]
      }] };
    }
  }],
  strategies: [{ name: "fixed", async extract() { return { data: { total: 42 } }; } }],
  classifiers: [{ name: "fixed", async classify() {
    return { classifier: "fixed", name: "invoice", confidence: 1 };
  } }]
};`;

async function workspace() {
  const cwd = await tempDir("envelope");
  await writeFixture(cwd, "docture.config.mjs", CONFIG);
  for (const name of ["good", "bad"]) {
    await writeFixture(cwd, `${name}.pdf`, "%PDF-1.7 pretend");
    await writeFixture(cwd, `${name}.expected.json`, '{"total":42}');
  }
  return cwd;
}

const COMMANDS = ["extract", "convert", "classify", "inspect", "eval"] as const;
const CASES = [
  { name: "one success", files: ["good.pdf"], code: 0 },
  { name: "one failure", files: ["bad.pdf"], code: 1 },
  { name: "mixed inputs", files: ["good.pdf", "bad.pdf"], code: 1 },
] as const;

describe("uniform output contract", () => {
  it.each([
    { error: new UsageError("bad flag", "use --format"), expected: { code: "USAGE", message: "bad flag", hint: "use --format" } },
    { error: new CliError("bad run", "try again"), expected: { code: "CLI", message: "bad run", hint: "try again" } },
    { error: new Error("plain error"), expected: { code: "INTERNAL", message: "plain error" } },
    { error: "thrown string", expected: { code: "INTERNAL", message: "thrown string" } },
  ])("assigns an error code to $expected.message", ({ error, expected }) => {
    expect(explain(error)).toEqual(expected);
  });

  for (const command of COMMANDS) {
    for (const format of ["json", "ndjson", "text"]) {
      it.each(CASES)(`${command} ${format} preserves $name`, async ({ files, code }) => {
        const cwd = await workspace();
        const run = await cli([
          command, ...files, "--format", format,
          ...(command === "convert" ? ["--out", "converted"] : []),
        ], { cwd });
        expect(run.code).toBe(code);
        if (format === "text") {
          if (files.some((file) => file === "good.pdf")) {
            if (command === "convert") {
              expect(await readFile(join(cwd, "converted/good.md"), "utf8")).toContain("Invoice");
            } else {
              expect(run.stdout).toContain(command === "extract" ? '"total": 42' : "good.pdf");
              if (command === "eval") expect(run.stderr).toContain("✓ good.pdf F1 1.000 → fixed via fake");
            }
          }
          if (code === 1) expect(run.stderr).toContain("✗ bad.pdf →");
          return;
        }
        if (format === "json") expect(run.stdout.trim()).toMatch(/^\{/);
        const parsed = format === "json" ? JSON.parse(run.stdout) : undefined;
        const items = format === "json"
          ? parsed.results
          : run.stdout.trim().split("\n").map((line) => JSON.parse(line));
        expect(items).toHaveLength(files.length);
        expect(items.map((item: { file: string }) => item.file)).toEqual(files);
        if (format === "json") {
          expect(parsed).toMatchObject({ version: 1, command, ok: code === 0 });
          expect(Object.keys(parsed).sort()).toEqual(
            command === "eval"
              ? ["command", "ok", "results", "summary", "version"]
              : ["command", "ok", "results", "version"],
          );
          if (command === "eval") expect(parsed.summary).toMatchObject({
            documents: files.length,
            failed: code === 1 ? 1 : 0,
            meanF1: files.length === 2 ? 0.5 : code === 0 ? 1 : 0,
            meanPrecision: files.length === 2 ? 0.5 : code === 0 ? 1 : 0,
            meanRecall: files.length === 2 ? 0.5 : code === 0 ? 1 : 0,
            metrics: {
              recall: files.length === 2 ? 0.5 : code === 0 ? 1 : 0,
              errorRate: files.length === 2 ? 0.5 : code === 0 ? 0 : 1,
            },
            gate: null,
            passed: code === 0,
          });
        }
        for (const item of items) {
          if (item.file === "bad.pdf") {
            expect(item).toEqual({ file: "bad.pdf", ok: false, error: {
                code: "LOAD_FAILED", message: "Every loader failed: fake (broken document).",
                hint: "The file could not be read — it may be corrupt, truncated, or password-protected.",
              } });
          } else if (command === "extract") {
            expect(item).toEqual({ file: "good.pdf", ok: true, data: { total: 42 } });
          } else if (command === "classify") {
            expect(item).toEqual({ file: "good.pdf", ok: true, name: "invoice", confidence: 1,
              signals: [{ classifier: "fixed", name: "invoice", confidence: 1 }] });
          } else if (command === "inspect") {
            expect(item).toEqual({ file: "good.pdf", ok: true, loader: "fake",
              features: { mimeType: "application/pdf", form: "digital", pageCount: 1, textLength: 7,
                hasTextLayer: false, hasGeometry: true, hasRenderablePages: false },
              pages: [{ pageNumber: 1, width: 600, height: 800, chars: 7, lines: 1 }] });
          } else if (command === "convert") {
            expect(item).toEqual({ file: "good.pdf", ok: true,
              output: join(cwd, "converted/good.md"), assets: [], warnings: [{
                code: "LAYOUT_DEGRADED", message: "Page 1 has lines but no loader-provided layout blocks.", pageNumber: 1,
              }] });
          } else {
            expect({ ...item, usage: { ...item.usage, wallMs: 0 } }).toEqual({
              file: "good.pdf", ok: true, method: "fixed",
              score: { f1: 1, precision: 1, recall: 1, exactMatch: true },
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, wallMs: 0 },
            });
          }
        }
      });
    }
  }

  it("defaults extract to an envelope and only adds record fields with --full", async () => {
    const cwd = await workspace();
    const simple = await cli(["extract", "good.pdf"], { cwd });
    const full = await cli(["extract", "good.pdf", "--full"], { cwd });
    expect(JSON.parse(simple.stdout)).toEqual({ version: 1, command: "extract", ok: true,
      results: [{ file: "good.pdf", ok: true, data: { total: 42 } }] });
    expect(JSON.parse(full.stdout)).toMatchObject({ version: 1, command: "extract", ok: true,
      results: [{ file: "good.pdf", ok: true, data: { total: 42 }, method: "fixed", loader: "fake" }] });
  });

  it("writes an envelope to an extract file and an item to each directory file, including failures", async () => {
    const cwd = await workspace();
    const single = await cli(["extract", "good.pdf", "-o", "result.json"], { cwd });
    expect(single.code).toBe(0);
    expect(JSON.parse(await readFile(join(cwd, "result.json"), "utf8"))).toEqual({
      version: 1, command: "extract", ok: true, results: [{ file: "good.pdf", ok: true, data: { total: 42 } }],
    });
    const batch = await cli(["extract", "good.pdf", "bad.pdf", "-o", "out/"], { cwd });
    expect(batch.code).toBe(1);
    expect(JSON.parse(await readFile(join(cwd, "out/good.json"), "utf8"))).toEqual({
      file: "good.pdf", ok: true, data: { total: 42 },
    });
    expect(JSON.parse(await readFile(join(cwd, "out/bad.json"), "utf8"))).toMatchObject({
      file: "bad.pdf", ok: false, error: { code: "LOAD_FAILED" },
    });
  });

  it("includes the eval gate verdict in the JSON summary", async () => {
    const cwd = await workspace();
    const run = await cli(["eval", "good.pdf", "bad.pdf", "--format", "json", "--min-f1", "0.9"], { cwd });
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: false,
      summary: {
        documents: 2, meanF1: 0.5, minF1: 0.9, passed: false, failed: 1,
        gate: { pass: false, checks: [{ kind: "threshold", metric: "meanDocumentF1", status: "fail", min: 0.9 }] },
        reasons: ["Mean F1 0.500 is below the --min-f1 gate of 0.9."],
      } });
  });

  it.each(["inspect", "classify"])("%s rejects the removed --json flag", async (command) => {
    const cwd = await workspace();
    const run = await cli([command, "good.pdf", "--json"], { cwd });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--json");
  });

  it("uses --to for conversion and --format for result encoding", async () => {
    const cwd = await workspace();
    const run = await cli(["convert", "good.pdf", "--out", "converted", "--to", "txt", "--format", "json"], { cwd });
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ version: 1, command: "convert", ok: true,
      results: [{ file: "good.pdf", ok: true, output: join(cwd, "converted/good.txt") }] });
    expect(await readFile(join(cwd, "converted/good.txt"), "utf8")).toContain("Invoice");
  });
});
