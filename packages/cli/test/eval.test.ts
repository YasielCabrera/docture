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

describe("eval quick mode", () => {
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
    expect(run.stdout).toContain("| bad.png | docture | 0 | errored | 0.0% |");
    expect(run.stdout).toContain("| Mean document F1 | 50.0% |");
    expect(run.stdout).toContain("ExtractionFailedError \\[EXTRACTION\\_FAILED\\]: Every extraction strategy failed: fixed (only PDFs, sorry).");
    expect(await readFile(join(cwd, "score.md"), "utf8")).toBe(run.stdout);
    expect(run.stderr).toContain("─ 2 documents · mean document F1 0.500 · field F1 ");
    expect(run.stderr).toContain("✗ bad.png → Every extraction strategy failed: fixed (only PDFs, sorry).");
    expect(run.stderr).toContain("✗ Gate failed: 1 of 1 checks.\n  Mean F1 0.500 is below the --min-f1 gate of 0.9.");
  });

  it("scores a perfect extraction at F1 1.000 and finds the truth beside the document", async () => {
    const cwd = await workspace(TRUTH);
    const run = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json"], { cwd });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("| Case | Experiment | Epoch | Outcome | F1 |");
    expect(run.stdout).toContain("| invoice.pdf | docture | 0 | scored | 100.0% |");
    expect(run.stdout).toContain("| Mean document F1 | 100.0% |");
    expect(run.stderr).toContain("✓ invoice.pdf F1 1.000 → fixed via fake");
    expect(run.stderr).toContain("No gate configured; no gate ran.");
  });

  it("runs the same scoring as `eval run` with files", async () => {
    const cwd = await workspace(TRUTH);
    const implicit = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--format", "json"], { cwd });
    const explicit = await cli(["eval", "run", "invoice.pdf", "-s", "./invoice.schema.json", "--format", "json"], { cwd });
    expect(explicit.code).toBe(0);
    const scores = (stdout: string) => JSON.parse(stdout).results.map((item: { file: string; score: unknown }) => [item.file, item.score]);
    expect(scores(explicit.stdout)).toEqual([["invoice.pdf", { f1: 1, precision: 1, recall: 1, exactMatch: true }]]);
    expect(scores(implicit.stdout)).toEqual(scores(explicit.stdout));
  });

  it("scores a partial extraction below 1 and names the fields that missed", async () => {
    const cwd = await workspace({ invoiceNumber: "INV-9", total: 42 });
    const run = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--verbose"], { cwd });

    expect(run.stdout).toContain("| invoice.pdf | docture | 0 | scored | 50.0% |");
    expect(run.stderr).toContain('mismatch      invoiceNumber: expected "INV-1", got "INV-9"');
    expect(run.stdout).toContain("| invoiceNumber | mismatch | INV-1 | INV-9 |");
  });

  it("gates on --min-f1, which is the reason the command exists", async () => {
    const cwd = await workspace({ invoiceNumber: "INV-9", total: 1 });

    const gated = await cli(
      ["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--min-f1", "0.9"],
      { cwd },
    );
    expect(gated.code).toBe(1);
    expect(gated.stderr).toContain("Mean F1 0.000 is below the --min-f1 gate of 0.9.");

    const ungated = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json"], { cwd });
    expect(ungated.code).toBe(0);
    const skipped = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--min-f1", "0.9", "--no-gate"], { cwd });
    expect(skipped.code).toBe(0);
  });

  it("gates --min-f1 on the mean of per-document F1, so a small failed document weighs as much as a large one", async () => {
    const cwd = await tempDir("eval-mean");
    const fields = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`f${index}`, index]));
    await writeFixture(cwd, "docture.config.mjs", `export default {
  loaders: [{
    name: "text", capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
    async load(raw) { const text = new TextDecoder().decode(raw.bytes); return { loader: "text", form: "digital", text, pages: [{ pageNumber: 1, width: 100, height: 100, text, lines: [] }] }; },
  }],
  strategies: [{ name: "reader", async extract(ctx) { return { data: ctx.document.text === "large" ? ${JSON.stringify(fields)} : { x: 0 } }; } }],
};
`);
    await writeFixture(cwd, "schema.json", '{"type":"object"}');
    for (const [name, truth] of [["large", fields], ["small", { x: 1 }]] as const) {
      await writeFixture(cwd, `${name}.txt`, name);
      await writeFixture(cwd, `${name}.expected.json`, JSON.stringify(truth));
    }
    const result = await cli(["eval", "large.txt", "small.txt", "-s", "schema.json", "--min-f1", ".8", "--format", "json"], { cwd });
    expect(result.code).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.results.map((item: { file: string; score: { f1: number } }) => [item.file, item.score.f1])).toEqual([["large.txt", 1], ["small.txt", 0]]);
    expect(output.summary.meanF1).toBe(0.5);
    expect(output.summary.metrics.meanDocumentF1).toBe(0.5);
    expect(output.summary.metrics.f1).toBeCloseTo(40 / 42, 10);
    expect(output.summary.reasons).toEqual(["Mean F1 0.500 is below the --min-f1 gate of 0.8."]);
    const text = await cli(["eval", "large.txt", "small.txt", "-s", "schema.json", "--min-f1", ".8"], { cwd });
    expect(text.stderr).toContain("─ 2 documents · mean document F1 0.500 · field F1 0.952 · 1 exact");
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
    expect(written).toMatch(/^# Eval scoreboard\n/);
    expect(written).toContain("| Case | Experiment | Epoch | Outcome | F1 |");
    expect(run.stdout).toContain("| Case | Experiment | Epoch | Outcome | F1 |");
  });

  it("writes the Markdown scoreboard to --report when stdout is JSON", async () => {
    const cwd = await workspace(TRUTH);
    const run = await cli(
      ["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--report", "score.md", "--format", "json"],
      { cwd },
    );

    expect(JSON.parse(run.stdout).summary.meanF1).toBe(1);
    expect(await readFile(join(cwd, "score.md"), "utf8")).toContain("| invoice.pdf | docture | 0 | scored | 100.0% |");
  });

  it("rejects config-mode flags beside files, and quick-mode flags without them", async () => {
    const cwd = await workspace(TRUTH);
    const mixed = await cli(["eval", "invoice.pdf", "-s", "./invoice.schema.json", "--experiment", "llm"], { cwd });
    expect(mixed.code).toBe(2);
    expect(mixed.stderr).toContain("--experiment need docture.eval.ts, not files.");
    const bare = await cli(["eval", "run", "--min-f1", "0.9"], { cwd });
    expect(bare.code).toBe(2);
    expect(bare.stderr).toContain("--min-f1 work only in quick mode, with files.");
  });
});
