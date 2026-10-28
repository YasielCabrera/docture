import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

const CONFIG = `import { MockLanguageModelV4 } from "ai/test";

const lines = ["Total due: $1,234.50", "Invoice INV-0042 issued by ACME Corp for consulting services."];
const page = {
  pageNumber: 1,
  width: 612,
  height: 792,
  text: lines.join("\\n"),
  lines: lines.map((text, index) => ({
    y: 100 + index * 20, height: 12, text,
    spans: [{ text, x: 72, y: 100 + index * 20, width: text.length * 6, height: 12 }],
  })),
};

const reply = (prompt) => JSON.stringify(JSON.stringify(prompt).includes("[p1-line-2]")
  ? { data: { total: 1234.5, vendor: "ACME" }, citations: [{ path: "total", ids: ["p1-line-1"] }, { path: "vendor", ids: ["p1-line-1"] }] }
  : { total: 1234.5, vendor: "ACME" });

export default {
  loaders: [{
    name: "fake",
    capabilities: { text: true, geometry: true, images: false, mimeTypes: ["*/*"] },
    async load() {
      return { pages: [page], text: page.text, form: "digital", loader: "fake" };
    },
  }],
  model: new MockLanguageModelV4({
    modelId: "mock-model",
    provider: "mock",
    async doGenerate(options) {
      return {
        content: [{ type: "text", text: reply(options.prompt) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
        warnings: [],
      };
    },
  }),
};
`;

const SCHEMA = JSON.stringify({
  type: "object",
  properties: { total: { type: "number" }, vendor: { type: "string" } },
  required: ["total", "vendor"],
  additionalProperties: false,
});

async function project(): Promise<string> {
  const cwd = await tempDir("extract-citations");
  await writeFixture(cwd, "docture.config.mjs", CONFIG);
  await writeFixture(cwd, "schema.json", SCHEMA);
  await writeFixture(cwd, "invoice.pdf", "%PDF-1.7\n");
  return cwd;
}

afterAll(cleanup);

describe("docture extract --citations", () => {
  it("adds verified field citations and their source lines to the full record", async () => {
    const cwd = await project();
    const run = await cli(["extract", "invoice.pdf", "--schema", "schema.json", "--citations", "--full"], { cwd });

    expect(run.code).toBe(0);
    const record = JSON.parse(run.stdout).results[0];
    expect(Object.keys(record)).toEqual([
      "file", "ok", "data", "method", "loader", "attempts", "usage", "features", "classification",
      "validation", "citations", "citationSources",
    ]);
    expect(record.validation).toEqual({ valid: true, issues: [] });
    expect(record.citations).toEqual([
      { path: "total", ids: ["p1-line-1"], status: "verified" },
      { path: "vendor", ids: ["p1-line-1"], status: "cited-unverified" },
    ]);
    expect(record.citationSources).toEqual([
      { id: "p1-line-1", pageNumber: 1, box: { x: 72, y: 100, width: 120, height: 12 }, text: "Total due: $1,234.50" },
    ]);
  });

  it("leaves citations out of the full record without the flag", async () => {
    const cwd = await project();
    const run = await cli(["extract", "invoice.pdf", "--schema", "schema.json", "--full"], { cwd });

    expect(run.code).toBe(0);
    const record = JSON.parse(run.stdout).results[0];
    expect(record.data).toEqual({ total: 1234.5, vendor: "ACME" });
    expect(record.validation).toEqual({ valid: true, issues: [] });
    expect("citations" in record).toBe(false);
    expect("citationSources" in record).toBe(false);
  });

  it("rejects --citations without --full", async () => {
    const cwd = await project();
    const run = await cli(["extract", "invoice.pdf", "--schema", "schema.json", "--citations"], { cwd });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--full");
    expect(run.stdout).toBe("");
  });

  it("warns that --citations is ignored when the config supplies its own strategies", async () => {
    const cwd = await project();
    await writeFixture(cwd, "docture.config.mjs", CONFIG.replace(
      "export default {",
      'export default {\n  strategies: [{ name: "fixed", async extract() { return { data: { total: 1, vendor: "x" } }; } }],',
    ));
    const run = await cli(["extract", "invoice.pdf", "--schema", "schema.json", "--citations", "--full"], { cwd });

    expect(run.code).toBe(0);
    expect(run.stderr).toContain("--citations is ignored: the config supplies its own strategies.");
    expect("citations" in JSON.parse(run.stdout).results[0]).toBe(false);
  });
});
