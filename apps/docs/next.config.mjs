import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The docs site is content-only; nothing here imports the workspace packages at
  // runtime, so no transpilePackages is needed.
};

export default withMDX(config);
