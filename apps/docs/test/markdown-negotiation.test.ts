import "next/dist/server/node-environment-baseline";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getRewrittenUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "../proxy";

const request = (path: string, accept: string) => new NextRequest(`https://docture.dev${path}`, { headers: { accept } });

describe("Markdown content negotiation", () => {
  it.each([
    ["/docs", "/llms.mdx/docs/content.md"],
    ["/docs/extraction/quick-start", "/llms.mdx/docs/extraction/quick-start/content.md"],
  ])("serves %s as Markdown when the client prefers it", (path, destination) => {
    expect(getRewrittenUrl(proxy(request(path, "text/markdown, text/html;q=0.8")))).toBe(`https://docture.dev${destination}`);
  });

  it.each([
    "text/html,application/xhtml+xml,*/*;q=0.8",
    "text/html, text/markdown;q=0",
    "text/html, text/markdown;q=0.5",
  ])("keeps HTML for Accept: %s", (accept) => {
    expect(getRewrittenUrl(proxy(request("/docs/extraction/quick-start", accept)))).toBeNull();
  });

  it.each([
    ["/docs/extraction/quick-start", true],
    ["/docs", true],
    ["/docs/extraction/quick-start.md", false],
    ["/llms.txt", false],
  ])("runs the proxy for %s: %s", (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });
});
