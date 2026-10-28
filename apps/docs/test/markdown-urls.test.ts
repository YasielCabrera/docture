import "next/dist/server/node-environment-baseline";
import { describe, expect, it } from "vitest";
import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import nextConfig from "../next.config.mjs";

describe("Markdown page URLs", () => {
  it.each([
    ["/docs.md", "/llms.mdx/docs/content.md"],
    ["/docs/quick-start.md", "/llms.mdx/docs/quick-start/content.md"],
    ["/docs/reference/api/testing.md", "/llms.mdx/docs/reference/api/testing/content.md"],
    ["/docs/quick-start.md?source=copy", "/llms.mdx/docs/quick-start/content.md?source=copy"],
  ])("serves %s through the Markdown endpoint", async (path, destination) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://docture.dev${path}`,
      nextConfig,
    });
    expect(getRewrittenUrl(response)).toBe(`https://docture.dev${destination}`);
  });

  it.each(["/docs", "/docs/quick-start", "/docs/reference/api/testing", "/other.md"])(
    "keeps %s outside the Markdown rewrites",
    async (path) => {
      const response = await unstable_getResponseFromNextConfig({
        url: `https://docture.dev${path}`,
        nextConfig,
      });
      expect(getRewrittenUrl(response)).toBeNull();
    },
  );
});
