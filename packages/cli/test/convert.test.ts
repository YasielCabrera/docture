import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRichDocumentPdf } from "docture/testing/fixtures";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

function conversionConfig(options: { failBad?: boolean; assisted?: boolean } = {}): string {
  return `
const makeLine = (text, y, style = {}) => ({
  y,
  height: 12,
  text,
  spans: [{ text, x: 40, y, width: text.length * 6, height: 12, style }],
});
export default {
  concurrency: 2,
  loaders: [{
    name: "fake",
    capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
    async load(raw, ctx) {
      ${options.failBad === true ? 'if (raw.fileName === "bad.pdf") throw new Error("broken document");' : ""}
      const heading = makeLine("Grounded Title", 30, { fontSize: 22, bold: true });
      const body = makeLine("Exact <body> text", 70, { fontSize: 11 });
      return {
        loader: "fake",
        form: "digital",
        text: heading.text + "\\n" + body.text,
        pages: [{
          pageNumber: 1,
          width: 600,
          height: 800,
          text: heading.text + "\\n" + body.text,
          lines: [heading, body],
          blocks: [
            { id: "heading", kind: "text", x: 40, y: 30, width: 160, height: 20, lines: [heading], role: "heading", level: 1 },
            { id: "body", kind: "text", x: 40, y: 70, width: 160, height: 12, lines: [body], role: "paragraph" },
            { id: "image", kind: "image", assetId: "image", x: 40, y: 110, width: 20, height: 20, alt: "pixel" },
          ],
          ...(ctx.request?.assets ? { assets: [{
            id: "image",
            pageNumber: 1,
            name: "pixel.png",
            mimeType: "image/png",
            bytes: new Uint8Array([1, 2, 3]),
            x: 40,
            y: 110,
            width: 20,
            height: 20,
          }] } : {}),
        }],
      };
    },
  }],
  ${options.assisted === true ? `layoutAnalyzer: {
    name: "configured-layout",
    async analyze() { return { annotations: [{ id: "body", role: "heading", level: 2 }] }; },
  },` : ""}
};
`;
}

async function workspace(files: readonly string[] = ["report.pdf"], config = conversionConfig()): Promise<string> {
  const dir = await tempDir("convert");
  await writeFixture(dir, "docture.config.mjs", config);
  for (const file of files) await writeFixture(dir, file, "%PDF-1.7 pretend");
  return dir;
}

describe("convert", () => {
  it.each(["referenced", "embedded", "omit"])("writes versioned JSON with %s assets", async (assets) => {
    const cwd = await workspace();
    const result = await cli(["convert", "report.pdf", "-o", "out", "--to", "json", "--assets", assets, "--format", "json"], { cwd });
    expect(result.code).toBe(0);
    const document = JSON.parse(await readFile(join(cwd, "out/report.json"), "utf8"));
    expect(document.schemaVersion).toBe(1);
    expect(document.loader).toBe("fake");
    expect(document.method).toBe("deterministic");
    expect(document.pages[0].elements[0]).toMatchObject({
      id: "heading", kind: "heading", text: "Grounded Title",
      provenance: { pageNumber: 1, sourceIds: ["heading"] },
    });
    if (assets === "referenced") {
      expect(document.assets).toEqual([{ id: "image", mimeType: "image/png", reference: "report.assets/page-1-image-1.png" }]);
      expect([...await readFile(join(cwd, "out/report.assets/page-1-image-1.png"))]).toEqual([1, 2, 3]);
    } else if (assets === "embedded") {
      expect(document.assets).toEqual([{ id: "image", mimeType: "image/png", data: "AQID" }]);
    } else {
      expect(document.assets).toEqual([]);
    }
    expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, command: "convert", ok: true });
  });

  it("requires an output directory", async () => {
    const cwd = await workspace();
    const run = await cli(["convert", "report.pdf"], { cwd });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("requires --out");
    expect(run.stdout).toBe("");
  });

  it("defaults to Markdown and writes referenced assets beneath the stem folder", async () => {
    const cwd = await workspace();
    const run = await cli(["convert", "report.pdf", "--out", "converted"], { cwd });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
    const markdown = await readFile(join(cwd, "converted", "report.md"), "utf8");
    expect(markdown).toContain("# Grounded Title");
    expect(markdown).toContain("![pixel](report.assets/page-1-image-1.png)");
    expect(new Uint8Array(await readFile(join(cwd, "converted", "report.assets", "page-1-image-1.png")))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("converts a real PDF through the default PDF.js loader", async () => {
    const cwd = await tempDir("convert-pdfjs");
    const fixture = await makeRichDocumentPdf();
    await writeFile(join(cwd, "rich.pdf"), fixture.bytes);

    const run = await cli(
      ["convert", "rich.pdf", "--out", "converted", "--no-config"],
      { cwd },
    );

    expect(run.code).toBe(0);
    const markdown = await readFile(join(cwd, "converted", "rich.md"), "utf8");
    expect(markdown).toContain(fixture.expected.title);
    expect(markdown).toContain(fixture.expected.secondPage);
    expect(markdown).toContain("rich.assets/page-1-image-1.png");
    const image = new Uint8Array(
      await readFile(join(cwd, "converted", "rich.assets", "page-1-image-1.png")),
    );
    expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("honours format and asset modes", async () => {
    const cwd = await workspace(["embedded.pdf", "plain.pdf"]);
    const html = await cli(
      ["convert", "embedded.pdf", "-o", "html", "--to", "html", "--assets", "embedded"],
      { cwd },
    );
    const text = await cli(
      ["convert", "plain.pdf", "-o", "text", "--to", "txt", "--assets", "omit"],
      { cwd },
    );
    expect(html.code).toBe(0);
    expect(await readFile(join(cwd, "html", "embedded.html"), "utf8")).toContain(
      "data:image/png;base64,AQID",
    );
    await expect(access(join(cwd, "html", "embedded.assets"))).rejects.toThrow();
    expect(text.code).toBe(0);
    const plain = await readFile(join(cwd, "text", "plain.txt"), "utf8");
    expect(plain).toContain("Exact <body> text");
    expect(plain).not.toContain("pixel");
  });

  it("detects basename collisions before config loading or document parsing", async () => {
    const cwd = await workspace(
      ["one/report.pdf", "two/report.pdf"],
      'throw new Error("the config must not load before collision detection");',
    );
    const run = await cli(
      ["convert", "one/report.pdf", "two/report.pdf", "--out", "converted"],
      { cwd },
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("would both be written");
    expect(run.stderr).not.toContain("config must not load");
  });

  it("keeps successful outputs when another input fails", async () => {
    const cwd = await workspace(["good.pdf", "bad.pdf"], conversionConfig({ failBad: true }));
    const run = await cli(
      ["convert", "good.pdf", "bad.pdf", "-o", "converted", "--concurrency", "2"],
      { cwd },
    );
    expect(run.code).toBe(1);
    expect(await readFile(join(cwd, "converted", "good.md"), "utf8")).toContain("Grounded Title");
    await expect(access(join(cwd, "converted", "bad.md"))).rejects.toThrow();
    expect(run.stderr).toContain("broken document");
  });

  it("uses a configured layout analyzer and validates assist-layout model requirements", async () => {
    const cwd = await workspace(["report.pdf"], conversionConfig({ assisted: true }));
    const configured = await cli(["convert", "report.pdf", "-o", "configured"], { cwd });
    expect(configured.code).toBe(0);
    expect(await readFile(join(cwd, "configured", "report.md"), "utf8")).toContain(
      "## Exact \\<body\\> text",
    );

    const missing = await cli(
      ["convert", "report.pdf", "-o", "missing", "--assist-layout", "--no-config"],
      { cwd },
    );
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("needs a model");
  });
});
