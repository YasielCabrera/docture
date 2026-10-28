import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  NoConvertibleContentError,
  type DocumentLoader,
  type LayoutAnalyzer,
  type LoadedDocument,
  type TextLine,
  type TextSpan,
} from "../../src/core/index.js";

import { bySourceId, span, line, richDocument } from "./conversion-fixtures.js";

const source = () => ({ loaded: richDocument(), fileName: "report.pdf", mimeType: "application/pdf" }) as const;

describe("DocumentConverter exports", () => {
  it("writes exact grounded TXT with form-feed page boundaries and no image placeholder", async () => {
    const result = await new DocumentConverter().convert(source(), { format: "text" });
    expect(result.content).toContain("Quarterly Report");
    expect(result.content).toContain("• First");
    expect(result.content).toContain("Name Value");
    expect(result.content).toContain("const exact = '<&>';\fSecond page");
    expect(result.content).not.toContain("chart");
    expect(result.pages[0]?.elements.at(-1)?.kind).toBe("page-break");
  });

  it("exports stable CommonMark with GFM tables, links, figures, and page markers", async () => {
    const result = await new DocumentConverter().convert(source());
    expect(result.mimeType).toBe("text/markdown");
    expect(result.content).toMatchInlineSnapshot(`
      "<!-- page: 1 -->

      # Quarterly Report

      A \\*literal\\* \\<value\\>. Visit [Docture](https://example.com/docs) unsafe

      - First
      - Second

      | Name | Value |
      | --- | --- |
      | Alpha | 10 |

      \`\`\`
      const exact = '<&>';
      \`\`\`

      ![chart](report.assets/page-1-image-1.png)

      <!-- page: 2 -->

      Second page"
    `);
    expect(result.assets[0]?.reference).toBe("report.assets/page-1-image-1.png");
    expect(result.warnings.map((warning) => warning.code)).toContain("UNSAFE_LINK");
  });

  it("exports a complete escaped HTML5 document", async () => {
    const result = await new DocumentConverter().convert(source(), { format: "html" });
    expect(result.content.startsWith("<!doctype html>")).toBe(true);
    expect(result.content).toContain("<title>Q3 &lt;Report&gt;</title>");
    expect(result.content).toContain('<section id="page-1" data-page-number="1">');
    expect(result.content).toContain('<a href="https://example.com/docs">Docture</a>');
    expect(result.content).not.toContain("javascript:");
    expect(result.content).toContain("<table><thead>");
    expect(result.content).toContain('<img src="report.assets/page-1-image-1.png" alt="chart">');
  });

  it("supports referenced, embedded, and omitted asset modes", async () => {
    const converter = new DocumentConverter();
    const referenced = await converter.convert(source(), { assets: "referenced" });
    const embedded = await converter.convert(source(), { assets: "embedded" });
    const omitted = await converter.convert(source(), { assets: "omit" });
    expect(referenced.content).toContain("report.assets/page-1-image-1.png");
    expect(embedded.content).toContain("data:image/png;base64,iVBORw==");
    expect(embedded.assets).toHaveLength(1);
    expect(omitted.content).not.toContain("![");
    expect(omitted.assets).toEqual([]);
  });

  it("keeps inferred column order and escapes paragraph-leading Markdown syntax", async () => {
    const makeBlock = (id: string, text: string, x: number, y: number) => {
      const value = line(y, [span(text, x, y)]);
      return {
        id,
        kind: "text" as const,
        x,
        y,
        width: 200,
        height: 12,
        lines: [value],
        role: "paragraph" as const,
      };
    };
    const blocks = [
      makeBlock("left-1", "# grounded paragraph", 20, 40),
      makeBlock("right-1", "Right one", 330, 50),
      makeBlock("left-2", "Left two", 20, 90),
      makeBlock("right-2", "Right two", 330, 100),
    ];
    const text = blocks.map((block) => block.lines[0]?.text ?? "").join("\n");
    const result = await new DocumentConverter().convert({
      loaded: {
        loader: "columns",
        form: "digital",
        text,
        pages: [{ pageNumber: 1, width: 600, height: 800, text, blocks }],
      },
    });

    expect(result.content).toContain("\\# grounded paragraph");
    expect(result.content.indexOf("Left two")).toBeLessThan(result.content.indexOf("Right one"));
  });
});

describe("DocumentConverter orchestration", () => {
  it("converts geometry-only and OCR-shaped pages conservatively", async () => {
    const ocrLine = line(40, [span("OCR grounded text", 20, 40, { confidence: 0.91 })]);
    const result = await new DocumentConverter().convert({
      loaded: {
        loader: "ocr-fixture",
        form: "scanned",
        text: ocrLine.text,
        pages: [
          {
            pageNumber: 1,
            width: 600,
            height: 800,
            text: ocrLine.text,
            lines: [ocrLine],
          },
        ],
      },
    });
    expect(result.pages[0]?.elements[0]?.kind).toBe("paragraph");
    expect(result.content).toContain("OCR grounded text");
    expect(result.warnings.map((warning) => warning.code)).toContain("LAYOUT_DEGRADED");
  });

  it("requests layout and only requests asset bytes when needed", async () => {
    const requests: unknown[] = [];
    const loader: DocumentLoader = {
      name: "fixture",
      capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
      async load(_raw, ctx) {
        requests.push(ctx.request);
        return richDocument();
      },
    };
    const converter = new DocumentConverter({ loaders: [loader] });
    const raw = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", fileName: "report.pdf" };
    await converter.convert(raw);
    await converter.convert(raw, { assets: "omit" });
    expect(requests).toEqual([
      { layout: true, assets: true },
      { layout: true, assets: false },
    ]);
  });

  it("fails scans without silently changing loaders or OCR modes", async () => {
    const empty = richDocument();
    const converter = new DocumentConverter();
    await expect(
      converter.convert({ loaded: { ...empty, text: "", form: "scanned", pages: empty.pages.map((page) => ({ ...page, text: "", lines: [], blocks: [] })) } }),
    ).rejects.toBeInstanceOf(NoConvertibleContentError);
  });

  it("applies valid model roles but ignores unknown ids and failures", async () => {
    const valid: LayoutAnalyzer = {
      name: "helper",
      async analyze({ document }) {
        return { annotations: bySourceId(document, [{ id: "paragraph", role: "heading", level: 2 }]), usage: { totalTokens: 7 } };
      },
    };
    const validResult = await new DocumentConverter({ layoutAnalyzer: valid }).convert(source());
    expect(validResult.method).toBe("deterministic+helper");
    expect(validResult.content).toContain("## A \\*literal\\*");
    expect(validResult.usage.totalTokens).toBe(7);

    const invalid: LayoutAnalyzer = {
      name: "invalid",
      async analyze() {
        return { annotations: [{ id: "invented", role: "heading" }] };
      },
    };
    const invalidResult = await new DocumentConverter({ layoutAnalyzer: invalid }).convert(source());
    expect(invalidResult.method).toBe("deterministic");
    expect(invalidResult.warnings.map((warning) => warning.code)).toContain("INVALID_LAYOUT_ANALYSIS");
    expect(invalidResult.content).not.toContain("invented");

    const invalidOrder: LayoutAnalyzer = {
      name: "invalid-order",
      async analyze(ctx) {
        return {
          annotations: (ctx.document.pages[0]?.elements ?? []).map((element) => ({
            id: element.id,
            order: 0,
          })),
        };
      },
    };
    const invalidOrderResult = await new DocumentConverter({ layoutAnalyzer: invalidOrder })
      .convert(source());
    expect(invalidOrderResult.method).toBe("deterministic");
    expect(invalidOrderResult.warnings.map((warning) => warning.code)).toContain(
      "INVALID_LAYOUT_ANALYSIS",
    );

    const failed: LayoutAnalyzer = {
      name: "failed",
      async analyze() {
        throw new Error("offline");
      },
    };
    const failedResult = await new DocumentConverter({ layoutAnalyzer: failed }).convert(source());
    expect(failedResult.warnings.map((warning) => warning.code)).toContain("LAYOUT_ANALYZER_FAILED");
    expect(failedResult.attempts.at(-1)?.status).toBe("failed");
  });

  it("batches partial failures and disposes components once", async () => {
    let disposed = 0;
    const loader: DocumentLoader = {
      name: "fixture",
      capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
      async load(raw) {
        if (raw.fileName === "bad.pdf") throw new Error("broken");
        return richDocument();
      },
      async dispose() {
        disposed += 1;
      },
    };
    const converter = new DocumentConverter({ loaders: [loader] });
    const sources = ["good.pdf", "bad.pdf"].map((fileName) => ({
      bytes: new Uint8Array([37, 80, 68, 70]),
      mimeType: "application/pdf",
      fileName,
    }));
    const outcomes = [];
    for await (const item of converter.convertBatch(sources, { concurrency: 2 })) outcomes.push(item.outcome.ok);
    expect(outcomes.sort()).toEqual([false, true]);
    await Promise.all([converter.dispose(), converter.dispose()]);
    expect(disposed).toBe(1);
  });
});
