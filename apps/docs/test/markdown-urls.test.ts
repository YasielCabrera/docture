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
    ["/docs/extraction/quick-start.md", "/llms.mdx/docs/extraction/quick-start/content.md"],
    ["/docs/resources/testing-api.md", "/llms.mdx/docs/resources/testing-api/content.md"],
    ["/docs/extraction/quick-start.md?source=copy", "/llms.mdx/docs/extraction/quick-start/content.md?source=copy"],
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
