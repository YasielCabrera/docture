import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";
import { source } from "@/lib/source";

// A sitemap must list absolute URLs, so a build without a known origin publishes an empty one.
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  if (origin === undefined) return [];
  return ["/", ...source.getPages().map((page) => page.url)].map((path) => ({ url: new URL(path, origin).href }));
}
