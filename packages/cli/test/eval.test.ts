import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

const TRUTH = { invoiceNumber: "INV-1", total: 42 };

function strategy(data: unknown): string {
  return `{
    name: "fixed",
    async extract() { return { data: ${JSON.stringify(data)} }; },
  }`;
}

async function workspace(extracted: unknown, options: { truth?: unknown } = {}) {
  const dir = await tempDir("eval");
  await writeFixture(dir, "docture.config.mjs", textLoaderConfig(["Invoice"], strategy(extracted)));
  await writeFixture(
    dir,
    "invoice.schema.json",
    JSON.stringify({ type: "object", properties: { invoiceNumber: { type: "string" }, total: { type: "number" } } }),
  );
  await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");
  await writeFixture(dir, "invoice.expected.json", JSON.stringify(options.truth ?? TRUTH));
  return dir;
}

describe("eval", () => {
  it.each([TRUTH, {}])("includes failed extractions with zero metrics in reports and gates for truth %j", async (truth) => {
    const cwd = await workspace(TRUTH);
    await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Invoice"], `{
      name: "fixed",
      async extract(ctx) {
        if (ctx.features.mimeType !== "application/pdf") throw new Error("only PDFs, sorry");
        return { data: ${JSON.stringify(TRUTH)} };
      }
    }`));
    await writeFixture(cwd, "bad.png", "pretend PNG");
    await writeFixture(cwd, "bad.expected.json", JSON.stringify(truth));
    const run = await cli([
      "eval", "invoice.pdf", "bad.png", "-s", "./invoice.schema.json",
      "--min-f1", "0.9", "--report", "score.md",
    ], { cwd });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("bad.png | 0.000 | 0.0% | 0.0% | no | failed |");
    expect(run.stdout).toContain("**2 documents** · mean F1 0.500 · 1 exact");
    expect(await readFile(join(cwd, "score.md"), "utf8")).toBe(run.stdout);
    expect(run.stderr).toContain("below the --min-f1 gate");
  });

  it("scores a perfect extraction at F1 1.000 and finds the truth beside the document", async () => {
    const cwd = await workspace(TRUTH);
    const run = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json"], { cwd });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("| Document | F1 |");
    expect(run.stdout).toContain("invoice.pdf | 1.000");
    expect(run.stdout).toContain("mean F1 1.000");
  });

  it("scores a partial extraction below 1 and names the fields that missed", async () => {
    const cwd = await workspace({ invoiceNumber: "INV-9", total: 42 });
    const run = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--verbose"], { cwd });

    expect(run.stdout).not.toContain("| 1.000 |");
    expect(run.stderr).toContain("invoiceNumber");
    expect(run.stderr).toContain("mismatch");
  });

  it("gates on --min-f1, which is the reason the command exists", async () => {
    const cwd = await workspace({ invoiceNumber: "INV-9", total: 1 });

    const gated = await cli(
      ["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--min-f1", "0.9"],
      { cwd },
    );
    expect(gated.code).toBe(1);
    expect(gated.stderr).toContain("below the --min-f1 gate");

    const ungated = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json"], { cwd });
    expect(ungated.code).toBe(0);
  });

  it("honours a numeric tolerance", async () => {
    const cwd = await workspace({ invoiceNumber: "INV-1", total: 42.004 });

    const strict = await cli(
      ["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--tolerance", "0.001", "--min-f1", "1"],
      { cwd },
    );
    expect(strict.code).toBe(1);

    const lenient = await cli(
      ["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--tolerance", "0.01", "--min-f1", "1"],
      { cwd },
    );
    expect(lenient.code).toBe(0);
  });

  it("reads ground truth from a --truth directory", async () => {
    const cwd = await workspace(TRUTH);
    await writeFixture(cwd, "truth/invoice.json", JSON.stringify(TRUTH));

    const run = await cli(
      ["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--truth", "truth", "--min-f1", "1"],
      { cwd },
    );
    expect(run.code).toBe(0);
  });

  it("fails fast, and by name, when a document has no ground truth", async () => {
    const dir = await tempDir("eval-notruth");
    await writeFixture(dir, "docture.config.mjs", textLoaderConfig(["Invoice"], strategy(TRUTH)));
    await writeFixture(dir, "invoice.schema.json", JSON.stringify({ type: "object" }));
    await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

    const run = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json"], { cwd: dir });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("No ground truth at");
    expect(run.stderr).toContain("invoice.expected.json");
  });

  it("writes the scoreboard to --report as well as stdout", async () => {
    const cwd = await workspace(TRUTH);
    const run = await cli(
      ["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--report", "score.md"],
      { cwd },
    );

    const written = await readFile(join(cwd, "score.md"), "utf8");
    expect(written).toContain("| Document | F1 |");
    expect(run.stdout).toContain("| Document | F1 |");
  });
});
