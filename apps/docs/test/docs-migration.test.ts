import "next/dist/server/node-environment-baseline";
import { describe, expect, it } from "vitest";
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../next.config.mjs";
import { legacyDocs } from "../lib/docs-migration";
import { legacyDestination } from "../lib/legacy-destination";

describe("legacy documentation links", () => {
  it("opens a moved section with its query intact", () => {
    const entry = legacyDocs.get("/docs/guides/document-conversion");
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("Missing conversion migration");
    expect(legacyDestination(entry, "#assets", "?source=bookmark")).toBe("/docs/conversion/assets?source=bookmark#assets");
  });

  it("opens a split API method on its current reference page", () => {
    const entry = legacyDocs.get("/docs/reference/api/eval");
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("Missing eval migration");
    expect(legacyDestination(entry, "#rescore", "")).toBe("/docs/evaluation/reference/runner#rescore");
  });

  it("preserves unknown fragments without interpreting object properties", () => {
    const entry = { to: "/docs/conversion/quick-start", anchors: {} };
    expect(legacyDestination(entry, "#constructor", "")).toBe("/docs/conversion/quick-start#constructor");
  });

  it("permanently redirects a one-to-one move", async () => {
    const response = await unstable_getResponseFromNextConfig({ url: "https://docture.dev/docs/guides/installation?source=bookmark", nextConfig });
    expect(response.status).toBe(308);
    expect(getRedirectUrl(response)).toBe("https://docture.dev/docs/getting-started/installation?source=bookmark");
  });

  it("keeps a split legacy route available to the fragment-aware bridge", async () => {
    const response = await unstable_getResponseFromNextConfig({ url: "https://docture.dev/docs/guides/document-conversion", nextConfig });
    expect(getRedirectUrl(response)).toBeNull();
  });

  it("redirects old Markdown URLs to canonical Markdown", async () => {
    const response = await unstable_getResponseFromNextConfig({ url: "https://docture.dev/docs/reference/api/eval.md", nextConfig });
    expect(response.status).toBe(308);
    expect(getRedirectUrl(response)).toBe("https://docture.dev/docs/evaluation/reference.md");
  });
});
