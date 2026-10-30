import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import doctureManifest from "../../../packages/docture/package.json" with { type: "json" };

const pendingChangesets = readdirSync(resolve(process.cwd(), "../../.changeset")).some((file) => file.endsWith(".md") && file !== "README.md");

export const docsRelease = pendingChangesets
  ? `${doctureManifest.version} plus unreleased changes`
  : doctureManifest.version.replace(/\.\d+$/, ".x");

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
