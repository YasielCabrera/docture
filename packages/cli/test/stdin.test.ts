import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { captureIo, run, type Io } from "../src/index.js";
import { INVOICE_JSON_SCHEMA, cleanup, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const TEXT_CONFIG = `const text = (raw) => new TextDecoder().decode(raw.bytes);
export default {
  loaders: [
    {
      name: "bytes",
      capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
      async load(raw) {
        const body = text(raw);
        return { pages: [{ pageNumber: 1, width: 595, height: 842, text: body }], text: body, form: "digital", loader: "bytes" };
      },
    },
  ],
  strategies: [
    {
      name: "parse",
      async extract(ctx) {
        const [invoiceNumber, total] = ctx.document.text.trim().split(" ");
        return { data: { invoiceNumber, total: Number(total) } };
      },
    },
  ],
  classifiers: [
    {
      name: "keyword",
      async classify(ctx) {
        return ctx.document.text.startsWith("INV")
          ? { classifier: "keyword", name: "invoice", confidence: 0.9 }
          : { classifier: "keyword", name: null, confidence: 0 };
      },
    },
  ],
  classifications: [{ name: "invoice", description: "a bill", schema: { type: "object" } }],
};
`;

const INVOICE_TEXT = new TextEncoder().encode("INV-1 42");

async function workspace(): Promise<string> {
  const dir = await tempDir("stdin");
  await writeFixture(dir, "docture.config.mjs", TEXT_CONFIG);
  await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
  await writeFixture(dir, "truth.json", JSON.stringify({ invoiceNumber: "INV-1", total: 42 }));
  await writeFixture(dir, "other.txt", "INV-2 7");
  return dir;
}

async function withStdin(argv: readonly string[], cwd: string, stdin: Uint8Array) {
  const io = captureIo({ cwd, stdin });
  const code = await run(argv, { io });
  return { code, stdout: io.stdout, stderr: io.stderr };
}

function untouchedStdin(cwd: string): Io & { readonly stdout: string; readonly stderr: string; reads: number } {
  const io = captureIo({ cwd });
  const counted = Object.create(io) as typeof io & { reads: number };
  counted.reads = 0;
  counted.readStdin = async () => {
    counted.reads += 1;
    throw new Error("stdin was read");
  };
  return counted;
}

describe("a - argument reads the document from stdin", () => {
  it("extracts stdin bytes and labels the result stdin", async () => {
    const cwd = await workspace();
    const result = await withStdin(["extract", "-", "-s", "invoice.schema.json"], cwd, INVOICE_TEXT);

    expect(result.stderr).not.toContain("error");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).results).toEqual([
      { file: "stdin", ok: true, data: { invoiceNumber: "INV-1", total: 42 } },
    ]);
  });

  it("names a directory output stdin.json", async () => {
    const cwd = await workspace();
    const result = await withStdin(["extract", "-", "other.txt", "-s", "invoice.schema.json", "-o", "out/"], cwd, INVOICE_TEXT);

    expect(result.code).toBe(0);
    expect(JSON.parse(await readFile(join(cwd, "out", "stdin.json"), "utf8"))).toEqual({
      file: "stdin", ok: true, data: { invoiceNumber: "INV-1", total: 42 },
    });
    expect(JSON.parse(await readFile(join(cwd, "out", "other.json"), "utf8")).data).toEqual({ invoiceNumber: "INV-2", total: 7 });
  });

  it("inspects and converts PDF bytes from stdin", async () => {
    const cwd = await tempDir("stdin-pdf");
    const pdf = (await makeInvoicePdf({ seed: 7 })).bytes;

    const inspected = await withStdin(["inspect", "-", "--format", "json", "--no-config"], cwd, pdf);
    expect(inspected.code).toBe(0);
    const report = JSON.parse(inspected.stdout).results[0];
    expect(report.file).toBe("stdin");
    expect(report.ok).toBe(true);
    expect(report.features.pageCount).toBe(1);

    const converted = await withStdin(["convert", "-", "--out", "out", "--to", "txt", "--format", "json", "--no-config"], cwd, pdf);
    expect(converted.code).toBe(0);
    expect(JSON.parse(converted.stdout).results[0]).toMatchObject({ file: "stdin", ok: true, output: join(cwd, "out", "stdin.txt") });
    expect(await readFile(join(cwd, "out", "stdin.txt"), "utf8")).toContain("INV-2026-4311");
  });

  it("classifies stdin bytes", async () => {
    const cwd = await workspace();
    const result = await withStdin(["classify", "-", "--format", "json"], cwd, INVOICE_TEXT);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).results[0]).toMatchObject({ file: "stdin", ok: true, name: "invoice" });
  });

  it("scores stdin against an explicit truth file", async () => {
    const cwd = await workspace();
    const result = await withStdin(
      ["eval", "-", "-s", "invoice.schema.json", "--truth", "truth.json", "--format", "json"],
      cwd,
      INVOICE_TEXT,
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).results[0]).toMatchObject({ file: "stdin", ok: true, score: { f1: 1 } });
  });

  it("rejects a second - before reading stdin", async () => {
    const cwd = await workspace();
    const io = untouchedStdin(cwd);
    const code = await run(["extract", "-", "-", "-s", "invoice.schema.json"], { io });

    expect(code).toBe(2);
    expect(io.reads).toBe(0);
    expect(io.stderr).toContain("stdin (-) can be read only once.");
  });

  it("requires one stdin input and a truth file for eval", async () => {
    const cwd = await workspace();
    const cases: readonly (readonly [readonly string[], string])[] = [
      [["eval", "-", "-s", "invoice.schema.json"], "eval reads stdin only with --truth <file>."],
      [["eval", "-", "-s", "invoice.schema.json", "--truth", "."], "eval reads stdin only with --truth <file>."],
      [["eval", "-", "other.txt", "-s", "invoice.schema.json", "--truth", "truth.json"], "eval cannot mix stdin with other inputs."],
    ];
    for (const [argv, message] of cases) {
      const io = untouchedStdin(cwd);
      expect(await run(argv, { io })).toBe(2);
      expect(io.reads).toBe(0);
      expect(io.stderr).toContain(message);
    }
  });
});
