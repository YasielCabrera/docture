import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseEvalResult, type EvalResult } from "../../src/index.js";
import { HTML_IDS, htmlReporter, panel, renderHtml, type HtmlView } from "../../src/reporters/html/index.js";
import { parseHtml } from "./html-dom.js";
import { WEIRD_ID, savedResult } from "./fixture.js";

async function embedded(html: string): Promise<{ readonly result: EvalResult; readonly view: HtmlView }> {
  const page = await parseHtml(html);
  const read = (id: string): unknown => JSON.parse(page.text(page.byId(id)!));
  return { result: parseEvalResult(read(HTML_IDS.result)), view: read(HTML_IDS.view) as HtmlView };
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`;

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("html reporter", () => {
  it("embeds the whole result so it round-trips through the page", async () => {
    const { result, view } = await embedded(renderHtml(savedResult(), { detail: "all" }));
    expect(result).toEqual(savedResult());
    expect(view.detail).toBe("all");
    expect(view.documents.rows.map((row) => [row.text[0], row.failed])).toEqual([
      ["c1", false], ["c2", true], ["c3", true], [WEIRD_ID, true], ["c1", false], ["c2", false], ["c3", true],
    ]);
    expect(view.sections.map((section) => section.id)).toEqual(["overview", "gate", "comparison", "paths", "calibration", "grounding", "warnings"]);
  });

  it("references nothing on the network and runs one inline client", async () => {
    const html = renderHtml(savedResult());
    expect(html).not.toMatch(/https?:/);
    const page = await parseHtml(html);
    const linked = page.elements.flatMap((node) => [node.attribs?.["src"], node.attribs?.["href"]]).filter((value) => value !== undefined);
    expect(linked).toEqual([]);
    const scripts = page.elements.filter((node) => node.name === "script").map((node) => node.attribs?.["type"] ?? "inline");
    expect(scripts).toEqual(["application/json", "application/json", "inline"]);
  });

  it("keeps hostile data inside its script element", async () => {
    const hostile = "</script><script>alert(1)</script><!--<script>";
    const source = savedResult();
    const result: EvalResult = { ...source, warnings: [hostile], cases: source.cases.map((row) => (row.outcome === "skipped" ? { ...row, reason: hostile } : row)) };
    const html = renderHtml(result, { detail: "all", title: "<b>Report</b>" });
    const page = await parseHtml(html);
    expect(page.elements.filter((node) => node.name === "script")).toHaveLength(3);
    expect(page.text(page.elements.find((node) => node.name === "title")!)).toBe("<b>Report</b>");
    expect((await embedded(html)).result).toEqual(result);
  });

  it("keeps only unmatched leaves and no whole documents by default", async () => {
    const { result, view } = await embedded(renderHtml(savedResult()));
    expect(view.detail).toBe("failures");
    const scored = result.cases.filter((row) => row.outcome === "scored");
    expect(scored.map((row) => [row.caseId, row.experiment, row.expected, row.actual, row.score.fields.map((field) => `${field.path} ${field.status}`)])).toEqual([
      ["c1", "llm", null, null, []],
      ["c2", "llm", null, null, ["issuer mismatch", "lineItems[1].amount mismatch"]],
      [WEIRD_ID, "llm", null, null, ["issuer mismatch", "issueDate mismatch"]],
      ["c1", "parser", null, null, []],
      ["c3", "parser", null, null, ["lineItems[1].sku omission", "lineItems[1].description omission", "lineItems[1].amount omission"]],
    ]);
    expect(result.summary).toEqual(savedResult().summary);
  });

  it("renders data panels computed on the server", async () => {
    const html = renderHtml(savedResult(), {
      panels: [
        panel.tiles("Headline", (result) => [{ label: "Auto-accept at 99%", value: result.calibration?.experiments["llm"]?.overall.coverageAtAccuracy["0.99"] ?? null, format: "ratio" }]),
        panel.bars("F1 by rendition", (result) => Object.entries(result.summary["llm"]!.slices["rendition"]!).map(([label, slice]) => ({ label, value: slice.metrics["f1"] ?? null }))),
      ],
    });
    const { view } = await embedded(html);
    expect(view.sections.find((section) => section.id === "panels")).toEqual({
      id: "panels",
      title: "",
      panels: [
        { kind: "tiles", title: "Headline", items: [{ label: "Auto-accept at 99%", text: "50.0%", tone: "neutral" }] },
        {
          kind: "bars",
          title: "F1 by rendition",
          max: 1,
          items: [
            { label: "digital", value: 12 / 13, text: "92.3%", tone: "fair" },
            { label: "scan", value: 22 / 39, text: "56.4%", tone: "bad" },
          ],
        },
      ],
    });
  });

  it("applies a theme without letting it reach the network or close the style element", async () => {
    const logo = "data:image/svg+xml;base64,PHN2Zy8+";
    const html = renderHtml(savedResult(), { theme: { accent: "#4f46e5", logo, css: "body{color:red}</style><script>alert(1)</script>" } });
    const page = await parseHtml(html);
    const style = page.text(page.elements.find((node) => node.name === "style")!);
    expect(style.endsWith(":root{--accent:#4f46e5}body{color:red}<\\/style><script>alert(1)<\\/script>")).toBe(true);
    expect(page.elements.find((node) => node.name === "img")?.attribs).toEqual({ class: "logo", alt: "", src: logo });
    expect(() => renderHtml(savedResult(), { theme: { accent: "red}</style>" } })).toThrow(TypeError);
    expect(() => renderHtml(savedResult(), { theme: { logo: "https://example.com/logo.png" } })).toThrow("theme.logo must be a data:image URL");
  });

  it("hands every page part to a template that replaces the shell", () => {
    const html = renderHtml(savedResult(), {
      title: "A < B",
      template: (parts) => `<!doctype html><head>${parts.csp}<title>${parts.title}</title><style>${parts.css}</style></head>${parts.body}${parts.data}<script>${parts.script}</script>`,
    });
    expect(html.startsWith(`<!doctype html><head>${CSP}<title>A &lt; B</title><style>`)).toBe(true);
    expect(html).toContain(`<main id="${HTML_IDS.app}"></main>`);
    expect(html).toContain(`<script type="application/json" id="${HTML_IDS.result}">`);
  });

  it("rewrites the file live with an in-progress banner that the final write removes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-html-"));
    directories.push(dir);
    const out = join(dir, "report.html");
    const final = savedResult();
    const reporter = htmlReporter({ out, live: { intervalMs: 0 } });
    await reporter.onRunStart?.({ ...final.run, status: "in-progress" });
    await reporter.onCase?.(final.cases[0]!, { completed: 1, total: 7, scored: 1, errored: 0, skipped: 0, elapsedMs: 10 });
    let html = "";
    for (let attempt = 0; attempt < 200 && !html.includes(`"caseId":"c1"`); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      html = await readFile(out, "utf8").catch(() => "");
    }
    const page = await parseHtml(html);
    expect(page.text(page.byId(HTML_IDS.banner)!)).toBe("This run is still in progress. The file is rewritten as cases finish; reload to see the latest.");
    const live = await embedded(html);
    expect([live.result.run.status, live.result.cases.length]).toEqual(["in-progress", 1]);
    await reporter.onResult(final);
    const done = await readFile(out, "utf8");
    expect((await parseHtml(done)).byId(HTML_IDS.banner)).toBeUndefined();
    expect((await embedded(done)).result.run.status).toBe("complete");
  });
});
