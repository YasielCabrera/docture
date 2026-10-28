import { access, link, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { afterAll, describe, expect, it, vi } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAICAYAAADaxo44AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVAiZY/z///9/BiyACZvg4JUAABofBAymvql2AAAAAElFTkSuQmCC";

const CONFIG = `const png = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0));
const span = (text, x, y, width = Math.max(10, text.length * 5), height = 12) => ({ text, x, y, width, height, style: { fontSize: 11 } });
const line = (y, spans, height = 12) => ({ y, height, text: spans.map((s) => s.text).join(" "), spans });
const rows = (y, cells) => cells.map(([a, b], i) => line(y + i * 20, [span(a, 40, y + i * 20), span(b, 200, y + i * 20)]));
const footer = (n) => line(770, [span("Page " + n, 280, 770)]);
const page = (pageNumber, lines) => ({
  pageNumber, width: 600, height: 800, text: lines.map((l) => l.text).join("\\n"), lines,
  image: async () => png,
});
const pages = [
  page(1, [line(80, [span("<script>alert(1)</script>", 60, 80, 120, 40)], 40), ...rows(640, [["Item", "Amount"], ["Alpha", "10"], ["Beta", "20"]]), footer(1)]),
  page(2, [...rows(100, [["Gamma", "30"], ["Delta", "40"], ["Epsilon", "50"]]), footer(2)]),
  page(3, [line(100, [span("Closing remarks", 40, 100)]), footer(3)]),
];
export default {
  loaders: [{
    name: "fixture",
    capabilities: { text: true, geometry: true, images: true, mimeTypes: ["*/*"] },
    async load() {
      return { pages, text: pages.map((p) => p.text).join("\\f"), form: "digital", loader: "fixture" };
    },
  }],
};
`;

const DISPOSABLE_CONFIG = `import { appendFileSync } from "node:fs";
const png = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0));
const text = "Hello";
const lines = [{ y: 80, height: 12, text, spans: [{ text, x: 40, y: 80, width: 50, height: 12, style: { fontSize: 11 } }] }];
let disposed = false;
export default {
  loaders: [{
    name: "disposable",
    capabilities: { text: true, geometry: true, images: true, mimeTypes: ["*/*"] },
    async load() {
      if (disposed) throw new Error("loader used after dispose");
      return { pages: [{ pageNumber: 1, width: 600, height: 800, text, lines, image: async () => png }], text, form: "digital", loader: "disposable" };
    },
    async dispose() {
      disposed = true;
      appendFileSync(new URL("./disposed.log", import.meta.url), "disposed\\n");
    },
  }],
};
`;

async function project(): Promise<string> {
  const cwd = await tempDir("review");
  await writeFixture(cwd, "docture.config.mjs", CONFIG);
  await writeFixture(cwd, "report.pdf", "%PDF-1.7\n");
  return cwd;
}

function pageSection(html: string, pageNumber: number): string {
  const start = html.indexOf(`<section class="page" data-page="${pageNumber}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</section>", start));
}

function boxStyles(section: string, element: string): string[] {
  return [...section.matchAll(new RegExp(`data-element="${element}"[^>]*style="([^"]*)"`, "g"))].map((match) => match[1] ?? "");
}

const REMOTE = /(?:src|href|action|poster|srcset)\s*=\s*"(?!data:|#)|url\(|@import|<link\b|<iframe\b|<object\b|<embed\b/i;

function v2Document(): unknown {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  return {
    schemaVersion: 2,
    loader: "fixture",
    method: "deterministic",
    assets: [],
    warnings: [],
    pages: [
      {
        pageNumber: 1,
        width: 600,
        height: 800,
        elements: [
          {
            id: "p1-text-1",
            kind: "table",
            rows: [["Region", "Q1"], ["North", "10"], ["", "12"]],
            headerRows: 1,
            spans: [{ row: 1, col: 0, rowSpan: 2, colSpan: 1 }],
            provenance: {
              pageNumber: 1,
              box: box(60, 600, 300, 200),
              sourceIds: ["p1-text-1"],
              continuations: [{ pageNumber: 2, box: box(60, 40, 300, 160), sourceIds: ["p2-text-1"] }],
            },
          },
          {
            id: "p1-text-2",
            kind: "page-header",
            text: "ACME & Co <confidential>",
            runs: [{ text: "ACME & Co <confidential>" }],
            evidence: "repeated",
            provenance: { pageNumber: 1, box: box(30, 8, 540, 16), sourceIds: ["p1-text-2"] },
          },
        ],
      },
      { pageNumber: 2, width: 600, height: 800, elements: [] },
    ],
  };
}

describe("docture review", () => {
  it("writes an offline page overlay with each element box at its percentage position", async () => {
    const cwd = await project();
    const run = await cli(["review", "report.pdf", "-o", "review.html"], { cwd });

    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");

    const first = pageSection(html, 1);
    expect(boxStyles(first, "p1-1dedae31b951")).toEqual(["left:10%;top:10%;width:20%;height:5%"]);
    expect(first).toContain('data-kind="paragraph"');
    expect(first).toContain(`<img src="data:image/png;base64,${PNG}"`);
    expect(first).toContain('style="aspect-ratio:600/800"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(REMOTE);
    expect(html).toContain("default-src 'none'");
  });

  it("draws a table that continues onto the next page once per page, never as a union box", async () => {
    const cwd = await project();
    expect((await cli(["review", "report.pdf", "-o", "review.html"], { cwd })).code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");

    expect(boxStyles(pageSection(html, 1), "p1-010d3a61615a")).toEqual(["left:6.6667%;top:80%;width:31.6667%;height:6.5%"]);
    expect(boxStyles(pageSection(html, 2), "p1-010d3a61615a")).toEqual(["left:6.6667%;top:12.5%;width:28.3333%;height:6.5%"]);
    expect(boxStyles(pageSection(html, 3), "p1-010d3a61615a")).toEqual([]);
    expect(pageSection(html, 2)).toContain('data-segment="2/2"');
    expect(boxStyles(pageSection(html, 3), "p3-8aad23ccd705")).toEqual(["left:46.6667%;top:96.25%;width:5%;height:1.5%"]);
    expect(pageSection(html, 3)).toContain('data-kind="page-footer"');
  });

  it("reviews saved conversion JSON against its source PDF, including furniture and merged cells", async () => {
    const cwd = await project();
    await writeFile(join(cwd, "report.json"), JSON.stringify(v2Document()));
    const run = await cli(["review", "--conversion", "report.json", "--source", "report.pdf", "-o", "saved.html"], { cwd });

    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "saved.html"), "utf8");
    expect(boxStyles(pageSection(html, 1), "p1-text-1")).toEqual(["left:10%;top:75%;width:50%;height:25%"]);
    expect(boxStyles(pageSection(html, 2), "p1-text-1")).toEqual(["left:10%;top:5%;width:50%;height:20%"]);
    expect(boxStyles(pageSection(html, 1), "p1-text-2")).toEqual(["left:5%;top:1%;width:90%;height:2%"]);
    expect(pageSection(html, 1)).toContain('data-kind="page-header"');
    expect(html).toContain("ACME &amp; Co &lt;confidential&gt;");
    expect(html).toContain('<td rowspan="2">North</td>');
    expect(html).not.toMatch(REMOTE);
  });

  it("round-trips convert --to json output into review", async () => {
    const cwd = await project();
    expect((await cli(["convert", "report.pdf", "-o", "out", "--to", "json"], { cwd })).code).toBe(0);
    const run = await cli(["review", "--conversion", "out/report.json", "--source", "report.pdf"], { cwd });

    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");
    expect(boxStyles(pageSection(html, 1), "p1-1dedae31b951")).toEqual(["left:10%;top:10%;width:20%;height:5%"]);
    expect(boxStyles(pageSection(html, 2), "p1-010d3a61615a")).toEqual(["left:6.6667%;top:12.5%;width:28.3333%;height:6.5%"]);
  });

  it("accepts a version 1 conversion snapshot", async () => {
    const cwd = await project();
    const v1 = {
      schemaVersion: 1, loader: "fixture", method: "deterministic", assets: [], warnings: [],
      pages: [{
        pageNumber: 1, width: 600, height: 800,
        elements: [{
          id: "p1-text-1", kind: "heading", level: 1, text: "Annual report", runs: [{ text: "Annual report" }],
          provenance: { pageNumber: 1, box: { x: 0, y: 0, width: 600, height: 80 }, sourceIds: ["p1-text-1"] },
        }],
      }],
    };
    await writeFile(join(cwd, "v1.json"), JSON.stringify(v1));
    const run = await cli(["review", "--conversion", "v1.json", "--source", "report.pdf", "-o", "v1.html"], { cwd });

    expect(run.code).toBe(0);
    const html = await readFile(join(cwd, "v1.html"), "utf8");
    expect(boxStyles(pageSection(html, 1), "p1-text-1")).toEqual(["left:0%;top:0%;width:100%;height:10%"]);
  });

  it("rejects malformed saved conversion JSON as a usage error naming the issue", async () => {
    const cwd = await project();
    const broken = v2Document() as { pages: { width: unknown }[] };
    broken.pages[0]!.width = "wide";
    await writeFile(join(cwd, "broken.json"), JSON.stringify(broken));
    await writeFile(join(cwd, "text.json"), "not json");

    const invalid = await cli(["review", "--conversion", "broken.json", "--source", "report.pdf"], { cwd });
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("[USAGE]");
    expect(invalid.stderr).toContain("pages.0.width");

    const unparsable = await cli(["review", "--conversion", "text.json", "--source", "report.pdf"], { cwd });
    expect(unparsable.code).toBe(2);
    expect(unparsable.stderr).toContain("is not JSON");
    await expect(access(join(cwd, "review.html"))).rejects.toThrow();
  });

  it("rejects ambiguous or incomplete invocations with exit 2", async () => {
    const cwd = await project();
    const cases: [readonly string[], string][] = [
      [["review"], "Pass the document to review"],
      [["review", "--conversion", "report.json"], "--source"],
      [["review", "report.pdf", "--conversion", "report.json", "--source", "report.pdf"], "either"],
      [["review", "--conversion", "a.json", "--extraction", "b.json", "--source", "report.pdf"], "either"],
      [["review", "report.pdf", "-o", "report.pdf"], "would overwrite"],
    ];
    for (const [argv, message] of cases) {
      const run = await cli(argv, { cwd });
      expect(run.code, argv.join(" ")).toBe(2);
      expect(run.stderr, argv.join(" ")).toContain(message);
    }
  });

  it("refuses an --out that is a symlink or hard link to the source or the saved file", async () => {
    const cwd = await project();
    await writeFixture(cwd, "report.json", JSON.stringify(v2Document()));
    await writeFixture(cwd, "result.json", JSON.stringify({ data: { total: 1 } }));
    await symlink("report.pdf", join(cwd, "source-link.html"));
    await link(join(cwd, "report.pdf"), join(cwd, "source-hard.html"));
    await symlink("report.json", join(cwd, "conversion-link.html"));
    await link(join(cwd, "result.json"), join(cwd, "extraction-hard.html"));
    const cases: readonly (readonly string[])[] = [
      ["review", "report.pdf", "-o", "source-link.html"],
      ["review", "report.pdf", "-o", "source-hard.html"],
      ["review", "--conversion", "report.json", "--source", "report.pdf", "-o", "conversion-link.html"],
      ["review", "--conversion", "report.json", "--source", "report.pdf", "-o", "source-hard.html"],
      ["review", "--extraction", "result.json", "--source", "report.pdf", "-o", "extraction-hard.html"],
    ];
    for (const argv of cases) {
      const run = await cli(argv, { cwd });
      expect(run.code, argv.join(" ")).toBe(2);
      expect(run.stderr, argv.join(" ")).toContain("would overwrite input");
    }
    expect(await readFile(join(cwd, "report.pdf"), "utf8")).toBe("%PDF-1.7\n");
    expect(JSON.parse(await readFile(join(cwd, "report.json"), "utf8"))).toEqual(v2Document());
    expect(JSON.parse(await readFile(join(cwd, "result.json"), "utf8"))).toEqual({ data: { total: 1 } });
  });

  it("keeps configured loaders open until the pages are rendered, then disposes them once", async () => {
    const cwd = await tempDir("review-dispose");
    await writeFixture(cwd, "report.pdf", "%PDF-1.7\n");
    await writeFixture(cwd, "docture.config.mjs", DISPOSABLE_CONFIG);

    const run = await cli(["review", "report.pdf"], { cwd });

    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    expect(await readFile(join(cwd, "disposed.log"), "utf8")).toBe("disposed\n");
    expect(pageSection(await readFile(join(cwd, "review.html"), "utf8"), 1)).toContain('data-element="p1-');
  });

  it("plans the review on --dry-run without reading the document or writing the file", async () => {
    const cwd = await project();
    const run = await cli(["review", "report.pdf", "--dpi", "150", "--dry-run"], { cwd });

    expect(run.code).toBe(0);
    const envelope = JSON.parse(run.stdout);
    expect(envelope).toMatchObject({ version: 1, command: "review", ok: true, summary: { dryRun: true } });
    expect(envelope.results[0].plan).toEqual({
      input: { kind: "path", path: join(cwd, "report.pdf") },
      review: "conversion",
      loaders: ["fixture"],
      layoutAnalyzer: null,
      model: null,
      dpi: 150,
      output: { to: "file", path: join(cwd, "review.html") },
    });
    await expect(access(join(cwd, "review.html"))).rejects.toThrow();
  });

  it("documents the command in help --json", async () => {
    const cwd = await project();
    const run = await cli(["help", "review", "--json"], { cwd });

    expect(run.code).toBe(0);
    const spec = JSON.parse(run.stdout).results[0].spec;
    expect(spec.name).toBe("review");
    expect(spec.flags.map((flag: { name: string }) => flag.name)).toEqual(expect.arrayContaining([
      "out", "dpi", "conversion", "extraction", "source", "item", "schema", "model", "dry-run",
    ]));
  });

  it("fails with the canvas install hint when the loader cannot render pages", async () => {
    const cwd = await tempDir("review-no-canvas");
    await writeFixture(cwd, "report.pdf", "%PDF-1.7\n");
    vi.doMock("@napi-rs/canvas", () => {
      throw new Error("native binding unavailable");
    });
    try {
      const run = await cli(["review", "report.pdf", "--no-config"], { cwd });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("Rendering pages needs @napi-rs/canvas");
      expect(run.stderr).toContain("`npm i @napi-rs/canvas@1.0.10`");
    } finally {
      vi.doUnmock("@napi-rs/canvas");
    }
  });

  it("renders a real PDF through PDF.js and the canvas rasterizer", async () => {
    const cwd = await tempDir("review-pdf");
    const invoice = await makeInvoicePdf({ seed: 7 });
    await writeFile(join(cwd, "invoice.pdf"), invoice.bytes);

    const run = await cli(["review", "invoice.pdf", "--no-config", "--dpi", "36"], { cwd });
    expect(run.stderr).not.toContain("error");
    expect(run.code).toBe(0);
    const section = pageSection(await readFile(join(cwd, "review.html"), "utf8"), 1);
    const image = /<img src="data:image\/png;base64,([^"]+)"/.exec(section)?.[1] ?? "";
    expect([...Buffer.from(image, "base64").subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(section).toContain(invoice.expected.invoiceNumber);
    expect(section).toMatch(/<div class="box kind-[a-z-]+" data-element="p1-[0-9a-f]{12}"/);
  });
});
