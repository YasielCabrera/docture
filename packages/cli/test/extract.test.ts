import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  INVOICE_JSON_SCHEMA,
  cleanup,
  cli,
  fixedStrategyConfig,
  tempDir,
  textLoaderConfig,
  writeFixture,
} from "./harness.js";

afterAll(cleanup);

/** A document, a config that answers with `data`, and a JSON Schema for it. */
async function workspace(data: unknown, options: { files?: readonly string[] } = {}) {
  const dir = await tempDir("extract");
  await writeFixture(
    dir,
    "docture.config.mjs",
    textLoaderConfig(["Invoice INV-1 total 42"], fixedStrategyBody(data)),
  );
  await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
  for (const file of options.files ?? ["invoice.pdf"]) {
    await writeFixture(dir, file, "%PDF-1.7 pretend");
  }
  return dir;
}

function fixedStrategyBody(data: unknown): string {
  return `{
    name: "fixed",
    async extract(ctx) {
      ctx.signal.throwIfAborted();
      return { data: ${JSON.stringify(data)} };
    },
  }`;
}

const INVOICE = { invoiceNumber: "INV-1", total: 42 };

describe("extract", () => {
  it("writes the extracted data to stdout and the story to stderr", async () => {
    const cwd = await workspace(INVOICE);
    const run = await cli(["extract", "invoice.pdf", "--schema", "./invoice.schema.json"], { cwd });

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ version: 1, command: "extract", ok: true, results: [{ file: "invoice.pdf", ok: true, data: INVOICE }] });
    // The split is the contract: nothing decorative may reach stdout.
    expect(run.stderr).toContain("invoice.pdf");
    expect(run.stderr).toContain("fixed");
    expect(run.stdout).not.toContain("fixed via");
  });

  it("emits one full record per line under --format ndjson", async () => {
    const cwd = await workspace(INVOICE, { files: ["a.pdf", "b.pdf"] });
    const run = await cli(
      ["extract", "a.pdf", "b.pdf", "-s", "./invoice.schema.json", "--format", "ndjson", "--full"],
      { cwd },
    );

    const lines = run.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l["file"]).sort()).toEqual(["a.pdf", "b.pdf"]);
    expect(lines[0]).toMatchObject({ ok: true, method: "fixed", loader: "fake" });
    expect(lines[0]).toHaveProperty("usage");
    expect(lines[0]).toHaveProperty("features");
  });

  it("returns envelope items in input order for several documents", async () => {
    const cwd = await workspace(INVOICE, { files: ["b.pdf", "a.pdf"] });
    const run = await cli(["extract", "b.pdf", "a.pdf", "-s", "./invoice.schema.json"], { cwd });

    const records = JSON.parse(run.stdout).results as { file: string }[];
    expect(records.map((r) => r.file)).toEqual(["b.pdf", "a.pdf"]);
  });

  it("writes one file per document when --out is a directory, and nothing to stdout", async () => {
    const cwd = await workspace(INVOICE, { files: ["a.pdf", "b.pdf"] });
    const run = await cli(
      ["extract", "a.pdf", "b.pdf", "-s", "./invoice.schema.json", "-o", "out/"],
      { cwd },
    );

    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
    expect(JSON.parse(await readFile(join(cwd, "out", "a.json"), "utf8"))).toEqual({ file: "a.pdf", ok: true, data: INVOICE });
    expect(JSON.parse(await readFile(join(cwd, "out", "b.json"), "utf8"))).toEqual({ file: "b.pdf", ok: true, data: INVOICE });
  });

  it("refuses an --out directory where two inputs would collide", async () => {
    const cwd = await workspace(INVOICE, { files: ["one/a.pdf", "two/a.pdf"] });
    const run = await cli(
      ["extract", "one/a.pdf", "two/a.pdf", "-s", "./invoice.schema.json", "-o", "out/"],
      { cwd },
    );

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("would both be written to");
  });

  it("keeps the other documents when one fails, and exits 1", async () => {
    const dir = await tempDir("extract-partial");
    await writeFixture(
      dir,
      "docture.config.mjs",
      textLoaderConfig(
        ["Invoice INV-1"],
        `{
          name: "sometimes",
          async extract(ctx) {
            if (ctx.features.mimeType === "application/pdf") return { data: ${JSON.stringify(INVOICE)} };
            throw new Error("only PDFs, sorry");
          },
        }`,
      ),
    );
    await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
    await writeFixture(dir, "good.pdf", "%PDF-1.7 pretend");
    await writeFixture(dir, "bad.png", "PNG\r\n\n pretend");

    const run = await cli(
      ["extract", "good.pdf", "bad.png", "-s", "./invoice.schema.json", "--format", "ndjson"],
      { cwd: dir },
    );

    expect(run.code).toBe(1);
    const records = run.stdout.trim().split("\n").map((l) => JSON.parse(l) as { file: string; ok: boolean });
    expect(records.find((r) => r.file === "good.pdf")?.ok).toBe(true);
    expect(records.find((r) => r.file === "bad.png")?.ok).toBe(false);
    expect(run.stderr).toContain("only PDFs, sorry");
  });

  it("says out loud that a JSON Schema cannot check the answer", async () => {
    const cwd = await workspace({ invoiceNumber: "INV-1", total: "forty-two" });
    const run = await cli(["extract", "invoice.pdf", "-s", "./invoice.schema.json"], { cwd });

    // A bare JSON Schema has no validator, so `total: "forty-two"` goes through.
    // That is the AI SDK's behaviour and not ours to override — but it must not be
    // a surprise, so the run warns before it produces the unchecked answer.
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("cannot check it");
  });

  it("fails a schema violation when the schema can actually validate", async () => {
    const dir = await tempDir("extract-violation");
    await writeFixture(
      dir,
      "docture.config.mjs",
      textLoaderConfig(
        ["Invoice"],
        fixedStrategyBody({ invoiceNumber: "INV-1", total: "forty-two" }),
      ),
    );
    await writeFixture(
      dir,
      "invoice.ts",
      `import { z } from "zod";
export default z.object({ invoiceNumber: z.string(), total: z.number() });
`,
    );
    await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

    const run = await cli(["extract", "invoice.pdf", "-s", "./invoice.ts"], { cwd: dir });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("total");
    expect(run.stderr).toContain("does not satisfy");
    expect(JSON.parse(run.stdout)).toMatchObject({ version: 1, command: "extract", ok: false, results: [{ file: "invoice.pdf", ok: false, error: { code: "CONTRACT_VIOLATION" } }] });
    // The hint is the CLI's job: core says what broke, this says what to do.
    expect(run.stderr).toContain("loosen the schema");
  });

  it("takes the schema from a Zod module, including a named export", async () => {
    const dir = await tempDir("extract-zod");
    await writeFixture(
      dir,
      "docture.config.mjs",
      textLoaderConfig(["Invoice"], fixedStrategyBody(INVOICE)),
    );
    await writeFixture(
      dir,
      "schemas.ts",
      `import { z } from "zod";
export const Invoice = z.object({ invoiceNumber: z.string(), total: z.number() });
export const Receipt = z.object({ merchant: z.string() });
`,
    );
    await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

    const ambiguous = await cli(["extract", "invoice.pdf", "-s", "./schemas.ts"], { cwd: dir });
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.stderr).toContain("more than one candidate");

    const named = await cli(["extract", "invoice.pdf", "-s", "./schemas.ts#Invoice"], { cwd: dir });
    expect(named.code).toBe(0);
    expect(JSON.parse(named.stdout).results[0].data).toEqual(INVOICE);
  });

  it("uses the config's schema when --schema is omitted", async () => {
    const dir = await tempDir("extract-config-schema");
    await writeFixture(
      dir,
      "docture.config.mjs",
      `import { z } from "zod";
${textLoaderConfig(["Invoice"], fixedStrategyBody(INVOICE)).replace(
  "export default {",
  "export default {\n  schema: z.object({ invoiceNumber: z.string(), total: z.number() }),",
)}`,
    );
    await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

    const run = await cli(["extract", "invoice.pdf"], { cwd: dir });
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ version: 1, command: "extract", ok: true, results: [{ file: "invoice.pdf", ok: true, data: INVOICE }] });
  });

  it("needs a model when nothing is wired", async () => {
    const dir = await tempDir("extract-bare");
    await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
    await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

    const run = await cli(
      ["extract", "invoice.pdf", "-s", "./invoice.schema.json", "--no-config"],
      { cwd: dir },
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--model");
  });

  it("says so when --model is ignored because the config wired strategies", async () => {
    const cwd = await workspace(INVOICE);
    const run = await cli(
      ["extract", "invoice.pdf", "-s", "./invoice.schema.json", "-m", "openai/gpt-5"],
      { cwd },
    );

    expect(run.code).toBe(0);
    expect(run.stderr).toContain("--model is ignored");
  });

  it("restricts to the strategies named by --only", async () => {
    const dir = await tempDir("extract-only");
    await writeFixture(
      dir,
      "docture.config.mjs",
      textLoaderConfig(
        ["Invoice"],
        `${fixedStrategyBody({ invoiceNumber: "first", total: 1 }).replace('"fixed"', '"first"')},
         ${fixedStrategyBody({ invoiceNumber: "second", total: 2 }).replace('"fixed"', '"second"')}`,
      ),
    );
    await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
    await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

    const first = await cli(["extract", "invoice.pdf", "-s", "./invoice.schema.json"], { cwd: dir });
    expect((JSON.parse(first.stdout).results[0].data as { invoiceNumber: string }).invoiceNumber).toBe("first");

    const second = await cli(
      ["extract", "invoice.pdf", "-s", "./invoice.schema.json", "--only", "second"],
      { cwd: dir },
    );
    expect((JSON.parse(second.stdout).results[0].data as { invoiceNumber: string }).invoiceNumber).toBe("second");
  });

  it("ignores a config entirely under --no-config", async () => {
    const cwd = await workspace(INVOICE);
    const run = await cli(
      ["extract", "invoice.pdf", "-s", "./invoice.schema.json", "--no-config"],
      { cwd },
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("Nothing is wired");
  });

  it("expands a quoted glob, and refuses one that matches nothing", async () => {
    const cwd = await workspace(INVOICE, { files: ["a.pdf", "b.pdf", "notes.txt"] });

    const matched = await cli(
      ["extract", "*.pdf", "-s", "./invoice.schema.json", "--format", "ndjson"],
      { cwd },
    );
    expect(matched.stdout.trim().split("\n")).toHaveLength(2);

    const missed = await cli(["extract", "*.tiff", "-s", "./invoice.schema.json"], { cwd });
    expect(missed.code).toBe(2);
    expect(missed.stderr).toContain("No files matched");
  });
});

describe("extract fixtures", () => {
  it("builds a config with no imports at all — the contracts are structural", async () => {
    // Not a behaviour of the CLI so much as a claim the rest of these tests rest on.
    expect(fixedStrategyConfig({ a: 1 })).not.toContain("import");
  });
});
