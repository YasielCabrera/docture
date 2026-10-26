import { defineConfig, mergeConfig } from "vitest/config";
import shared from "./vitest.shared.js";

/**
 * Root config: runs every package's tests in one pass (`pnpm test:watch`, or
 * `npx vitest run` for a quick whole-repo check).
 *
 * Each package also has its own four-line config merging the same base, which is what
 * lets Turborepo run and cache `test` per package.
 */
export default mergeConfig(
  shared,
  defineConfig({
    test: { include: ["packages/*/test/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/docs/test/**/*.test.ts"] },
  }),
);
