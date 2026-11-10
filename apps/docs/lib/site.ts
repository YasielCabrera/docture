import { resolve } from "node:path";
import doctureManifest from "../../../packages/docture/package.json" with { type: "json" };
import { hasUnreleasedChanges } from "./release";

export const docsRelease = hasUnreleasedChanges(resolve(process.cwd(), "../.."))
  ? `${doctureManifest.version} plus unreleased changes`
  : doctureManifest.version.replace(/\.\d+$/, ".x");

export const docsRevision = process.env.DOCS_REVISION ?? "unavailable";

// Next resolves relative metadata URLs on Vercel by itself; the sitemap and llms.txt need the origin explicitly.
export function siteOrigin(): string | undefined {
  if (process.env.SITE_URL) return new URL(process.env.SITE_URL).origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return undefined;
}

export function absoluteUrl(path: string): string {
  const origin = siteOrigin();
  return origin === undefined ? path : new URL(path, origin).href;
}
