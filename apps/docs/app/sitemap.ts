import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  if (origin === undefined) {
    if (process.env.NODE_ENV === "production") throw new Error("Set SITE_URL or VERCEL_PROJECT_PRODUCTION_URL before building the documentation sitemap.");
    return [];
  }
  return ["/", ...source.getPages().map((page) => page.url)].map((path) => ({ url: new URL(path, origin).href }));
}
