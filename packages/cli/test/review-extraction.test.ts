import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAICAYAAADaxo44AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVAiZY/z///9/BiyACZvg4JUAABofBAymvql2AAAAAElFTkSuQmCC";

const CONFIG = `import { MockLanguageModelV4 } from "ai/test";
const png = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0));
const line = (y, text, x = 60, width = 240) => ({ y, height: 20, text, spans: [{ text, x, y, width, height: 20 }] });
const page = (pageNumber, lines) => ({
  pageNumber, width: 600, height: 800, text: lines.map((l) => l.text).join("\\n"), lines, image: async () => png,
});
const pages = [
  page(1, [line(80, "ACME Corp invoice for consulting services rendered in October.")]),
  page(2, [line(160, "Total due: $1,234.50"), line(200, "Tax: 98", 60, 120)]),
];
const reply = (prompt) => JSON.stringify(JSON.stringify(prompt).includes("[p2-line-1]")
  ? { data: { total: 1234.5, vendor: "ACME" }, citations: [{ path: "total", ids: ["p2-line-1"] }, { path: "vendor", ids: ["p2-line-1"] }] }
  : { total: 1234.5, vendor: "ACME" });
export default {
  loaders: [{
    name: "fixture",
    capabilities: { text: true, geometry: true, images: true, mimeTypes: ["*/*"] },
    async load() {
      return { pages, text: pages.map((p) => p.text).join("\\f"), form: "digital", loader: "fixture" };
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

const RESULT = {
  file: "invoice.pdf",
  ok: true,
  data: { total: 1234.5, tax: 99, note: "<script>alert(1)</script>", items: [{ sku: "A-1" }], discount: null },
  validation: { valid: true, issues: [] },
  citations: [
    { path: "total", ids: ["p2-line-1"], status: "verified" },
    { path: "tax", ids: ["p2-line-2"], status: "cited-unverified" },
    { path: "note", ids: [], status: "uncited" },
  ],
  citationSources: [
    { id: "p2-line-1", pageNumber: 2, box: { x: 60, y: 160, width: 240, height: 20 }, text: "Total due: $1,234.50" },
    { id: "p2-line-2", pageNumber: 2, box: { x: 60, y: 200, width: 120, height: 20 }, text: "Tax: 98" },
  ],
};

const DATED_CONFIG = CONFIG.replace(
  '{ data: { total: 1234.5, vendor: "ACME" }, citations: [',
  '{ data: { total: 1234.5, vendor: "ACME", issued: "2024-01-01" }, citations: [{ path: "issued", ids: ["p1-line-1"] }, ',
).replace(': { total: 1234.5, vendor: "ACME" });', ': { total: 1234.5, vendor: "ACME", issued: "2024-01-01" });');

const DATED_SCHEMA = `import { jsonSchema } from "ai";
export default jsonSchema(
  {
    type: "object",
    properties: { total: { type: "number" }, vendor: { type: "string" }, issued: { type: "string", format: "date" } },
    required: ["total", "vendor", "issued"],
    additionalProperties: false,
  },
  { validate: (value) => ({ success: true, value: { ...value, issued: new Date(value.issued) } }) },
);
`;

async function project(): Promise<string> {
  const cwd = await tempDir("review-extraction");
  await writeFixture(cwd, "docture.config.mjs", CONFIG);
  await writeFixture(cwd, "schema.json", SCHEMA);
  await writeFixture(cwd, "invoice.pdf", "%PDF-1.7\n");
  await writeFixture(cwd, "result.json", JSON.stringify(RESULT));
  return cwd;
}

function pageSection(html: string, pageNumber: number): string {
  const start = html.indexOf(`<section class="page" data-page="${pageNumber}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</section>", start));
}

function fieldButton(html: string, path: string): string {
  return /<button [^>]*>/.exec(html.slice(html.indexOf(`data-path="${path}"`) - 120))?.[0] ?? "";
}

const REMOTE = /(?:src|href|action|poster|srcset)\s*=\s*"(?!data:|#)|url\(|@import|<link\b|<iframe\b|<object\b|<embed\b|fetch\(|XMLHttpRequest|WebSocket/i;

function interactive(html: string) {
  class Node {
    readonly classes: Set<string>;
    readonly listeners = new Map<string, (event: { key?: string; preventDefault(): void }) => void>();
    constructor(readonly attributes: Map<string, string>) {
      this.classes = new Set((attributes.get("class") ?? "").split(" ").filter(Boolean));
    }
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
    addEventListener(type: string, listener: (event: { key?: string; preventDefault(): void }) => void): void {
      this.listeners.set(type, listener);
    }
    get classList() {
      return { toggle: (name: string, on: boolean) => (on ? this.classes.add(name) : this.classes.delete(name)) };
    }
    focus(): void {}
  }
  const nodes = (pattern: RegExp): Node[] =>
    [...html.matchAll(pattern)].map((match) => new Node(new Map([...(match[0].matchAll(/([a-z-]+)="([^"]*)"/g))].map((a) => [a[1]!, a[2]!]))));
  const buttons = nodes(/<button [^>]*>/g);
  const lines = nodes(/<div class="line"[^>]*>/g);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  runInNewContext(script, {
    document: { querySelectorAll: (selector: string) => (selector === "button.field" ? buttons : lines) },
  });
  const field = (path: string): Node => buttons.find((button) => button.getAttribute("data-path") === path)!;
  return {
    click: (path: string) => field(path).listeners.get("click")?.({ preventDefault() {} }),
    key: (path: string, key: string) => field(path).listeners.get("keydown")?.({ key, preventDefault() {} }),
    selected: () => lines.filter((line) => line.classes.has("selected")).map((line) => line.getAttribute("data-line")),
    pressed: () => buttons.filter((button) => button.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-path")),
  };
}

describe("docture review for extraction results", () => {
  it("lists every present leaf with its citation status and the exact lines it cites", async () => {
    const cwd = await project();
    const run = await cli(["review", "--extraction", "result.json", "--source", "invoice.pdf", "-o", "review.html"], { cwd });

    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");

    expect(fieldButton(html, "total")).toContain('data-status="verified" data-targets="p2-line-1"');
    expect(fieldButton(html, "tax")).toContain('data-status="cited-unverified" data-targets="p2-line-2"');
    expect(fieldButton(html, "note")).toBe(
      '<button type="button" class="field status-uncited" aria-pressed="false" data-path="note" data-status="uncited">',
    );
    expect(fieldButton(html, "items.0.sku")).toContain('data-status="uncited">');
    expect(html).not.toContain('data-path="discount"');

    expect(pageSection(html, 2)).toContain('<div class="line" data-line="p2-line-1" style="left:10%;top:20%;width:40%;height:2.5%"');
    expect(pageSection(html, 1)).not.toContain("data-line=");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toMatch(REMOTE);
    expect(html).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
  });

  it("highlights only the selected field's cited line, and moves with the arrow keys", async () => {
    const cwd = await project();
    await cli(["review", "--extraction", "result.json", "--source", "invoice.pdf"], { cwd });
    const page = interactive(await readFile(join(cwd, "review.html"), "utf8"));

    page.click("total");
    expect(page.selected()).toEqual(["p2-line-1"]);
    expect(page.pressed()).toEqual(["total"]);
    page.key("total", "ArrowDown");
    expect(page.selected()).toEqual(["p2-line-2"]);
    expect(page.pressed()).toEqual(["tax"]);
    page.click("note");
    expect(page.selected()).toEqual([]);
    expect(page.pressed()).toEqual(["note"]);
  });

  it("requires --item for a batch envelope and reviews the chosen result", async () => {
    const cwd = await project();
    const second = { ...RESULT, file: "second.pdf", data: { total: 7 }, citations: [{ path: "total", ids: ["p2-line-2"], status: "verified" }] };
    await writeFile(join(cwd, "batch.json"), JSON.stringify({ version: 1, command: "extract", ok: true, results: [RESULT, second] }));

    const ambiguous = await cli(["review", "--extraction", "batch.json", "--source", "invoice.pdf"], { cwd });
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.stderr).toContain("holds 2 results");
    expect(ambiguous.stderr).toContain("--item <n>, from 0 to 1");

    const outOfRange = await cli(["review", "--extraction", "batch.json", "--source", "invoice.pdf", "--item", "2"], { cwd });
    expect(outOfRange.code).toBe(2);
    expect(outOfRange.stderr).toContain("--item 2 is out of range");

    const chosen = await cli(["review", "--extraction", "batch.json", "--source", "invoice.pdf", "--item", "1"], { cwd });
    expect(chosen.code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");
    expect(fieldButton(html, "total")).toContain('data-targets="p2-line-2"');
    expect(html).not.toContain('data-path="tax"');
  });

  it("rejects a saved result whose citations do not hold together", async () => {
    const cwd = await project();
    const unknownLine = { ...RESULT, citations: [{ path: "total", ids: ["p9-line-1"], status: "verified" }] };
    const halfCited = { file: "invoice.pdf", ok: true, data: {}, citations: [] };
    const failed = { file: "invoice.pdf", ok: false, error: { code: "LOAD_FAILED", message: "corrupt file" } };
    await writeFile(join(cwd, "unknown.json"), JSON.stringify(unknownLine));
    await writeFile(join(cwd, "half.json"), JSON.stringify(halfCited));
    await writeFile(join(cwd, "failed.json"), JSON.stringify(failed));

    const cases: [string, string][] = [
      ["unknown.json", "citations.0.ids.0: names p9-line-1, which citationSources does not hold"],
      ["half.json", "citationSources: must be present with the other"],
      ["failed.json", "failed, so there is nothing to review: corrupt file"],
    ];
    for (const [file, message] of cases) {
      const run = await cli(["review", "--extraction", file, "--source", "invoice.pdf"], { cwd });
      expect(run.code, file).toBe(2);
      expect(run.stderr, file).toContain(message);
    }
  });

  it("marks every field not requested when the result was extracted without citations", async () => {
    const cwd = await project();
    await writeFile(join(cwd, "plain.json"), JSON.stringify({ file: "invoice.pdf", ok: true, data: { total: 1234.5 } }));
    const run = await cli(["review", "--extraction", "plain.json", "--source", "invoice.pdf"], { cwd });

    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");
    expect(fieldButton(html, "total")).toContain('data-status="not-requested">');
    expect(html).toContain("This result has no citations.");
  });

  it("round-trips extract --full --citations output into review", async () => {
    const cwd = await project();
    const extracted = await cli(["extract", "invoice.pdf", "-s", "schema.json", "--citations", "--full", "-o", "extracted.json"], { cwd });
    expect(extracted.code).toBe(0);

    const run = await cli(["review", "--extraction", "extracted.json", "--source", "invoice.pdf"], { cwd });
    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");
    expect(fieldButton(html, "total")).toContain('data-status="verified" data-targets="p2-line-1"');
    expect(fieldButton(html, "vendor")).toContain('data-status="cited-unverified" data-targets="p2-line-1"');
    expect(pageSection(html, 2)).toContain('data-line="p2-line-1" style="left:10%;top:20%;width:40%;height:2.5%"');
  });

  it("shows a date field as its ISO string, the same as a saved result", async () => {
    const cwd = await project();
    await writeFixture(cwd, "docture.config.mjs", DATED_CONFIG);
    await writeFixture(cwd, "dated.ts", DATED_SCHEMA);

    const fresh = await cli(["review", "invoice.pdf", "--schema", "./dated.ts", "-o", "fresh.html"], { cwd });
    expect(fresh.stderr).not.toContain("error");
    expect(fresh.code).toBe(0);
    const extracted = await cli(["extract", "invoice.pdf", "-s", "./dated.ts", "--citations", "--full", "-o", "dated.json"], { cwd });
    expect(extracted.code).toBe(0);
    const saved = await cli(["review", "--extraction", "dated.json", "--source", "invoice.pdf", "-o", "saved.html"], { cwd });
    expect(saved.code).toBe(0);

    const issued = (html: string) => /<li><button [^>]*data-path="issued"[\s\S]*?<\/li>/.exec(html)?.[0];
    const freshHtml = await readFile(join(cwd, "fresh.html"), "utf8");
    expect(issued(freshHtml)).toContain('<span class="value">2024-01-01T00:00:00.000Z</span>');
    expect(issued(freshHtml)).toBe(issued(await readFile(join(cwd, "saved.html"), "utf8")));
    expect(freshHtml).toContain("3 fields");
  });

  it("keeps configured loaders open through extraction and rendering, then disposes them once", async () => {
    const cwd = await project();
    await writeFixture(
      cwd,
      "docture.config.mjs",
      `import { appendFileSync } from "node:fs";\n${CONFIG}`.replace(
        "async load() {",
        `async dispose() { this.disposed = true; appendFileSync(new URL("./disposed.log", import.meta.url), "disposed\\n"); },
    async load() {
      if (this.disposed) throw new Error("loader used after dispose");`,
      ),
    );

    const run = await cli(["review", "invoice.pdf", "--schema", "schema.json", "-o", "fresh.html"], { cwd });

    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    expect(await readFile(join(cwd, "disposed.log"), "utf8")).toBe("disposed\n");
    expect(fieldButton(await readFile(join(cwd, "fresh.html"), "utf8"), "total")).toContain('data-status="verified"');
  });

  it("extracts with citations when given a schema, and plans that on --dry-run", async () => {
    const cwd = await project();
    const run = await cli(["review", "invoice.pdf", "--schema", "schema.json", "-o", "fresh.html"], { cwd });

    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "fresh.html"), "utf8");
    expect(fieldButton(html, "total")).toContain('data-status="verified" data-targets="p2-line-1"');

    const planned = await cli(["review", "invoice.pdf", "--schema", "schema.json", "--dry-run"], { cwd });
    expect(planned.code).toBe(0);
    expect(JSON.parse(planned.stdout).results[0].plan).toEqual({
      input: { kind: "path", path: join(cwd, "invoice.pdf") },
      review: "extraction",
      loaders: ["fixture"],
      strategies: ["llm"],
      classifiers: [],
      model: "mock/mock-model",
      schema: join(cwd, "schema.json"),
      dpi: 96,
      output: { to: "file", path: join(cwd, "review.html") },
    });
  });
});
