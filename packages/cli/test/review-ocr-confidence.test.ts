import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAICAYAAADaxo44AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVAiZY/z///9/BiyACZvg4JUAABofBAymvql2AAAAAElFTkSuQmCC";

const CONFIG = `import { MockLanguageModelV4 } from "ai/test";
const png = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0));
const words = (y, scored) => {
  let x = 60;
  const spans = scored.map(([text, confidence]) => {
    const span = { text, x, y, width: text.length * 8, height: 20, confidence };
    x += text.length * 8 + 6;
    return span;
  });
  return { y, height: 20, text: scored.map(([text]) => text).join(" "), spans };
};
const pages = [{
  pageNumber: 1, width: 600, height: 800, image: async () => png,
  lines: [
    words(160, [["Total", 0.31], ["due:", 0.99], ["$1,234.50", 0.82]]),
    words(200, [["Vendor", 0.64], ["Initech", 0.9]]),
    words(240, [["Thank", 0.99], ["you", 0.99], ["for", 0.99], ["your", 0.99], ["business", 0.99], ["this", 0.99], ["quarter", 0.99]]),
  ],
}];
pages[0].text = pages[0].lines.map((l) => l.text).join("\\n");
const reply = (prompt) => JSON.stringify({
  data: { total: 1234.5, vendor: "ACME" },
  citations: [{ path: "total", ids: ["p1-line-1"] }, { path: "vendor", ids: ["p1-line-2"] }],
});
export default {
  loaders: [{
    name: "fixture",
    capabilities: { text: true, geometry: true, images: true, mimeTypes: ["*/*"] },
    async load() {
      return { pages, text: pages[0].text, form: "scanned", loader: "fixture" };
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
  const cwd = await tempDir("review-ocr");
  await writeFixture(cwd, "docture.config.mjs", CONFIG);
  await writeFixture(cwd, "schema.json", SCHEMA);
  await writeFixture(cwd, "invoice.pdf", "%PDF-1.7\n");
  return cwd;
}

function fieldItem(html: string, path: string): string {
  const start = html.indexOf(`data-path="${path}"`);
  return html.slice(start, html.indexOf("</li>", start));
}

describe("OCR confidence in extract output and review", () => {
  it("writes each cited field's OCR confidence and shows it beside the field", async () => {
    const cwd = await project();
    const extracted = await cli(["extract", "invoice.pdf", "-s", "schema.json", "--citations", "--full", "-o", "extracted.json"], { cwd });
    expect(extracted.stderr).not.toContain("error");
    expect(extracted.code).toBe(0);
    const saved = JSON.parse(await readFile(join(cwd, "extracted.json"), "utf8")) as { results: { citations: unknown }[] };
    expect(saved.results[0]?.citations).toEqual([
      { path: "total", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.82 },
      { path: "vendor", status: "cited-unverified", ids: ["p1-line-2"], minOcrConfidence: 0.64 },
    ]);

    const review = await cli(["review", "--extraction", "extracted.json", "--source", "invoice.pdf"], { cwd });
    expect(review.code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");
    expect(fieldItem(html, "total")).toContain('<span class="ocr">lowest OCR confidence 0.82</span>');
    expect(fieldItem(html, "vendor")).toContain('<span class="ocr">lowest OCR confidence 0.64</span>');
  });

  it("rejects a saved OCR confidence outside 0 to 1", async () => {
    const cwd = await project();
    await writeFile(join(cwd, "bad.json"), JSON.stringify({
      file: "invoice.pdf",
      ok: true,
      data: { total: 1 },
      citations: [{ path: "total", ids: ["p1-line-1"], status: "verified", minOcrConfidence: 1.5 }],
      citationSources: [{ id: "p1-line-1", pageNumber: 1, box: { x: 60, y: 160, width: 240, height: 20 }, text: "Total 1" }],
    }));

    const run = await cli(["review", "--extraction", "bad.json", "--source", "invoice.pdf"], { cwd });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("citations.0.minOcrConfidence: must be a number from 0 to 1");
  });
});
