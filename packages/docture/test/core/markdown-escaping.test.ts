import { describe, expect, it } from "vitest";
import { DocumentConverter, type DocumentElement, type InlineText, type LoadedDocument } from "../../src/core/index.js";

const box = { x: 0, y: 0, width: 100, height: 10 };

function paragraph(id: string, text: string, runs: readonly InlineText[] = [{ text }]): DocumentElement {
  return { id, kind: "paragraph", text, runs, provenance: { pageNumber: 1, box, sourceIds: [id] } };
}

function document(elements: readonly DocumentElement[], extra: Partial<LoadedDocument["pages"][number]> = {}): LoadedDocument {
  return {
    loader: "native",
    form: "digital",
    text: "source",
    pages: [{ pageNumber: 1, width: 600, height: 800, text: "source", layout: elements, ...extra }],
  };
}

async function markdown(loaded: LoadedDocument, fileName?: string): Promise<string> {
  const result = await new DocumentConverter().convert({ loaded, ...(fileName === undefined ? {} : { fileName }) });
  return result.content.replace(/^<!-- page: 1 -->\n\n/u, "");
}

describe("Markdown escaping of literal text", () => {
  it.each([
    ["a backtick fence", "```js\nnot code", "\\`\\`\\`js\nnot code"],
    ["a tilde fence", "~~~ text\nnot code", "\\~\\~\\~ text\nnot code"],
    ["a tab-indented line", "Intro\n\tindented", "Intro\nindented"],
    ["a four-space indented line", "    indented", "indented"],
    ["a table-shaped paragraph", "a | b\n--- | ---", "a \\| b\n--- \\| ---"],
    ["an entity reference", "&lt;div&gt; and &copy; and &#169;", "&amp;lt;div&amp;gt; and &amp;copy; and &amp;#169;"],
    ["a strikethrough lookalike", "~~gone~~", "\\~\\~gone\\~\\~"],
    ["a spaced hyphen rule", "Intro\n-- -", "Intro\n\\-- -"],
    ["a rule of hyphen runs", "--- ---", "\\--- ---"],
  ])("keeps %s as literal paragraph text", async (_case, text, expected) => {
    expect(await markdown(document([paragraph("p", text)]))).toBe(expected);
  });

  it("keeps a heading's trailing hash", async () => {
    const heading: DocumentElement = {
      id: "h", kind: "heading", level: 2, text: "Issue #", runs: [{ text: "Issue #" }],
      provenance: { pageNumber: 1, box, sourceIds: ["h"] },
    };
    expect(await markdown(document([heading]))).toBe("## Issue \\#");
  });

  it("fences code with one more backtick than the longest run inside it", async () => {
    const code: DocumentElement = {
      id: "c", kind: "code", text: "a ```` b ``` c", provenance: { pageNumber: 1, box, sourceIds: ["c"] },
    };
    expect(await markdown(document([code]))).toBe("`````\na ```` b ``` c\n`````");
  });

  it("wraps a link destination that holds spaces or parentheses in angle brackets", async () => {
    const runs = [
      { text: "docs", href: "https://example.com/a b(1)" },
      { text: " and " },
      { text: "plain", href: "https://example.com/plain" },
      { text: " and " },
      { text: "angled", href: "https://example.com/<x>" },
    ];
    expect(await markdown(document([paragraph("p", "docs and plain and angled", runs)])))
      .toBe("[docs](<https://example.com/a b(1)>) and [plain](https://example.com/plain) and [angled](<https://example.com/\\<x\\>>)");
  });

  it("percent-encodes a line break inside a link destination", async () => {
    const runs = [{ text: "wrapped", href: "https://example.com/a b\nc\r\nd" }];
    expect(await markdown(document([paragraph("p", "wrapped", runs)])))
      .toBe("[wrapped](<https://example.com/a b%0Ac%0D%0Ad>)");
  });

  it("percent-encodes asset path segments so # and ? stay part of the file name", async () => {
    const figure: DocumentElement = {
      id: "f", kind: "figure", assetId: "img", provenance: { pageNumber: 1, box, sourceIds: ["f"] },
    };
    const loaded = document([figure], {
      assets: [{
        id: "img", pageNumber: 1, name: "chart.png", mimeType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]),
        x: 0, y: 0, width: 100, height: 10,
      }],
    });
    expect(await markdown(loaded, "report #2 ?final.pdf")).toBe("![](report%20%232%20%3Ffinal.assets/page-1-image-1.png)");
  });
});
