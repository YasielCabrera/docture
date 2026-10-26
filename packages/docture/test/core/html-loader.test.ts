import { describe, expect, it, vi } from "vitest";
import { DocumentLoaderData } from "../../src/core/index.js";

const raw = (text: string, mimeType: string) => ({ bytes: new TextEncoder().encode(text), mimeType });

describe("HTML text loading", () => {
  it("parses external declarations and resource URLs without fetching them", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected resource fetch"));
    try {
      const loader = new DocumentLoaderData();
      expect((await loader.load(raw(
        '<img src="https://example.invalid/image.png"><p>Visible</p>', "text/html",
      ))).text).toBe("Visible");
      expect((await loader.load(raw(
        '<!DOCTYPE html SYSTEM "https://example.invalid/document.dtd"><p>&external; &amp;</p>', "application/xhtml+xml",
      ))).text).toBe("&external; &");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("keeps body text when HTML omits the optional head end tag", async () => {
    for (const source of [
      "<head><title>Title</title><body><p>Visible invoice</p>",
      "<head><title>Title</title><p>Visible invoice</p>",
      "<html><title>Title</title><body><p>Visible invoice</p>",
    ]) {
      expect((await new DocumentLoaderData().load(raw(source, "text/html"))).text).toBe("Visible invoice");
    }
  });

  it("decodes the complete HTML character-reference set without decoding twice", async () => {
    for (const mimeType of ["text/html", "application/xhtml+xml"]) {
      const document = await new DocumentLoaderData().load(raw(
        "<p>Caf&eacute; &eacute;lan &NotEqualTilde; &#x80; &amp;copy;</p>", mimeType,
      ));
      expect(document.text).toBe("Café élan ≂̸ € &copy;");
    }
  });

  it("preserves HTML textarea text and literal XHTML CDATA", async () => {
    const loader = new DocumentLoaderData();
    expect((await loader.load(raw(
      "<textarea><b>literal</b> &amp; value</textarea>", "text/html",
    ))).text).toBe("<b>literal</b> & value");
    expect((await loader.load(raw(
      "<p><![CDATA[hello <there> & more &amp;copy;]]></p>", "application/xhtml+xml",
    ))).text).toBe("hello <there> & more &amp;copy;");
  });

  it("keeps outer table cell boundaries around a nested table", async () => {
    const document = await new DocumentLoaderData().load(raw(
      "<table><tr><td>A<table><tr><td>Nested</td></tr></table></td><td>B</td></tr></table>", "text/html",
    ));
    expect(document.text).toBe("A\nNested\n\tB");
  });

  it("preserves literal comparisons that do not start HTML tags", async () => {
    const document = await new DocumentLoaderData().load(raw("<p>1 < 2 and 3 > 0</p>", "text/html"));
    expect(document.text).toBe("1 < 2 and 3 > 0");
    expect((await new DocumentLoaderData().load(raw("<p>Literal < text continues</p>", "text/html"))).text)
      .toBe("Literal < text continues");
  });

  it("keeps HTML hidden tags open despite a self-closing slash", async () => {
    const document = await new DocumentLoaderData().load(raw(
      "<script/>hidden script</script><style/>secret style</style><template/>secret template</template><p>Visible &AMP; clear</p>",
      "text/html",
    ));
    expect(document.text).toBe("Visible & clear");
    const xhtml = await new DocumentLoaderData().load(raw(
      "<script/><p>Visible</p>", "application/xhtml+xml",
    ));
    expect(xhtml.text).toBe("Visible");
  });

  it("keeps visible headings, blocks and table cells while dropping hidden source", async () => {
    const html = '<!doctype html><html><head><title>Inv</title><style>.a{color:red}</style><script>var key="sk-123";</script></head><body><!-- secret --><h1>Invoice 42</h1><p>Total: <b>$10.00</b></p><table><tr><td>A</td><td>1</td></tr></table><template>hidden template</template><noscript>hidden fallback</noscript></body></html>';
    const document = await new DocumentLoaderData().load(raw(html, "text/html"));
    expect(document.text).toBe("# Invoice 42\nTotal: $10.00\nA\t1");
    expect(document.pages.map((page) => page.text)).toEqual(["# Invoice 42\nTotal: $10.00\nA\t1"]);
  });

  it("decodes entities and keeps one XHTML page across form feeds", async () => {
    const document = await new DocumentLoaderData().load(raw(
      '<h2>First &amp; second</h2><p>Price &#36;10&#x2e;50&nbsp;EUR</p>\f<ul><li>One</li><li>Two &lt; three</li></ul>',
      "application/xhtml+xml",
    ));
    expect(document.text).toBe("## First & second\nPrice $10.50 EUR\n- One\n- Two < three");
    expect(document.pages).toHaveLength(1);
  });

  it("handles quoted tag delimiters, nested hidden nodes and raw script text", async () => {
    const document = await new DocumentLoaderData().load(raw(
      '<div title="a>b">Before</div><template><template>secret</template>also hidden</template><script>if (x < y) { z = "<b>secret</b>"; }</script><p>After</p>',
      "text/html",
    ));
    expect(document.text).toBe("Before\nAfter");
  });

  it("preserves plain text, Markdown, CSV and JSON page splitting", async () => {
    for (const mimeType of ["text/plain", "text/markdown", "text/csv", "application/json"]) {
      const document = await new DocumentLoaderData().load(raw("<literal>&amp;\fsecond", mimeType));
      expect(document.text).toBe("<literal>&amp;\fsecond");
      expect(document.pages.map((page) => page.text)).toEqual(["<literal>&amp;", "second"]);
    }
  });
});
