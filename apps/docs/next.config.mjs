import migration from "./lib/docs-migration.json" with { type: "json" };
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  redirects() {
    return Object.entries(migration).flatMap(([source, entry]) => {
      const split = Object.entries(entry.anchors).some(([anchor, target]) => target !== `${entry.to}#${anchor}`);
      return [
        ...(split ? [] : [{ source, destination: entry.to, permanent: true }]),
        { source: `${source}.md`, destination: `${entry.to}.md`, permanent: true },
      ];
    });
  },
  headers() {
    return [{ source: "/docs/:path*", headers: [{ key: "Vary", value: "Accept" }] }];
  },
  rewrites() {
    return [
      { source: "/docs.md", destination: "/llms.mdx/docs/content.md" },
      {
        source: "/docs/:slug+.md",
        destination: "/llms.mdx/docs/:slug+/content.md",
      },
    ];
  },
  // The docs site is content-only; nothing here imports the workspace packages at
  // runtime, so no transpilePackages is needed.
};

export default withMDX(config);
