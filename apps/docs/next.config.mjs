import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
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
