import { describe, expect, it } from "vitest";
import { markdownPageUrl, rewriteMarkdownLinks, websiteMarkdownLink } from "../lib/markdown-links";

const context = {
  origin: "https://docture.example",
  pageUrl: "/docs/extraction/quick-start",
  pageUrls: new Set(["/docs", "/docs/extraction/quick-start", "/docs/extraction/schemas"]),
};

describe("website Markdown navigation", () => {
  it.each([
    ["/docs", "https://docture.example/docs.md"],
    ["/docs/extraction/schemas/#missing-values", "https://docture.example/docs/extraction/schemas.md#missing-values"],
    ["/docs/extraction/schemas.md?source=agent#missing-values", "https://docture.example/docs/extraction/schemas.md?source=agent#missing-values"],
    ["schemas", "https://docture.example/docs/extraction/schemas.md"],
    ["#install", "https://docture.example/docs/extraction/quick-start.md#install"],
    ["?source=copy#install", "https://docture.example/docs/extraction/quick-start.md?source=copy#install"],
    ["https://docture.example/docs/extraction/schemas#missing-values", "https://docture.example/docs/extraction/schemas.md#missing-values"],
    ["/api-symbols.json", "https://docture.example/api-symbols.json"],
    ["/schemas/document.schema.json", "https://docture.example/schemas/document.schema.json"],
    ["https://other.example/docs", "https://other.example/docs"],
    ["mailto:docs@example.com", "mailto:docs@example.com"],
  ])("keeps %s usable after copying a page", (url, expected) => {
    expect(websiteMarkdownLink(url, context)).toBe(expected);
  });

  it("keeps local development links usable without a configured public origin", () => {
    expect(websiteMarkdownLink("#install", { ...context, origin: undefined })).toBe("/docs/extraction/quick-start.md#install");
  });

  it("rewrites table and reference links without editing literal code", () => {
    const code = 'const link = "[Schema](/docs/extraction/schemas)";\nconst component = <SourceExample file="invoice.ts" />;';
    const input = [
      "| Page |", "| --- |", "| [Schema](/docs/extraction/schemas#missing-values) |", "",
      "[Schema][schema]", "", "[schema]: /docs/extraction/schemas", "",
      "`[Schema](/docs/extraction/schemas)`", "", '```tsx title="example.tsx"', code, "```",
    ].join("\n");
    const output = rewriteMarkdownLinks(input, (url) => websiteMarkdownLink(url, context));
    expect(output).toContain("[Schema](https://docture.example/docs/extraction/schemas.md#missing-values)");
    expect(output).toContain("[schema]: https://docture.example/docs/extraction/schemas.md");
    expect(output).toContain("`[Schema](/docs/extraction/schemas)`");
    expect(output).toContain(code);
    expect(output).toContain('title="example.tsx"');
  });

  it("preserves query strings and fragments when deriving symbol destinations", () => {
    expect(markdownPageUrl("/docs/api?source=index#symbol")).toBe("/docs/api.md?source=index#symbol");
    expect(markdownPageUrl("/docs/api.md#symbol")).toBe("/docs/api.md#symbol");
  });
});
