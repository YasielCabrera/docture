import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  DocumentLoaderData,
  type ConversionFormat,
} from "../../src/core/index.js";

describe("text-only conversion", () => {
  it.each([
    { format: "markdown", expected: "<!-- page: 1 -->\n\n\\# Title\n\nHello" },
    { format: "text", expected: "# Title\n\nHello" },
    {
      format: "html",
      expected: '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Converted document</title>\n</head>\n<body>\n<section id="page-1" data-page-number="1">\n<p># Title</p>\n<p>Hello</p>\n</section>\n</body>\n</html>\n',
    },
  ] satisfies readonly { format: ConversionFormat; expected: string }[])(
    "preserves literal Markdown source in $format output",
    async ({ format, expected }) => {
      const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderData());
      const result = await converter.convert({
        bytes: new TextEncoder().encode("# Title\n\nHello"),
        mimeType: "text/markdown",
      }, { format });

      expect(result.content).toBe(expected);
      expect(result.pages[0]?.elements.map((element) => ({
        kind: element.kind,
        text: "text" in element ? element.text : undefined,
      }))).toEqual([
        { kind: "paragraph", text: "# Title" },
        { kind: "paragraph", text: "Hello" },
      ]);
      expect(result.warnings).toEqual([{
        code: "LAYOUT_DEGRADED",
        message: "Page 1 has no loader-provided layout blocks or lines.",
        pageNumber: 1,
      }]);
    },
  );

  it.each(["\n\n", "\r\n\r\n", "\n \t\n"])(
    "keeps plain-text paragraphs in order across blank lines %j",
    async (separator) => {
      const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderData());
      const result = await converter.convert({
        bytes: new TextEncoder().encode(`First paragraph${separator}Second paragraph`),
        mimeType: "text/plain",
      }, { format: "text" });

      expect(result.content).toBe("First paragraph\n\nSecond paragraph");
      expect(result.pages[0]?.elements.map((element) => ({
        kind: element.kind,
        text: "text" in element ? element.text : undefined,
        box: element.provenance.box,
      }))).toEqual([
        { kind: "paragraph", text: "First paragraph", box: { x: 0, y: 0, width: 0, height: 0 } },
        { kind: "paragraph", text: "Second paragraph", box: { x: 0, y: 0, width: 0, height: 0 } },
      ]);
    },
  );

  it("converts a third-party page with empty layout arrays and preserves paragraph line breaks", async () => {
    const result = await new DocumentConverter().convert({
      loaded: {
        loader: "third-party-text-only",
        form: "digital",
        text: "First line\nSecond line\n\nNext paragraph",
        pages: [{
          pageNumber: 1,
          width: 600,
          height: 800,
          text: "First line\nSecond line\n\nNext paragraph",
          blocks: [],
          lines: [],
        }],
      },
    }, { format: "text" });

    expect(result.content).toBe("First line\nSecond line\n\nNext paragraph");
    expect(result.pages[0]?.elements.map((element) => ({
      kind: element.kind,
      text: "text" in element ? element.text : undefined,
    }))).toEqual([
      { kind: "paragraph", text: "First line\nSecond line" },
      { kind: "paragraph", text: "Next paragraph" },
    ]);
    expect(result.warnings).toEqual([{
      code: "LAYOUT_DEGRADED",
      message: "Page 1 has no loader-provided layout blocks or lines.",
      pageNumber: 1,
    }]);
  });
});
