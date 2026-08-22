import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Shared Vitest configuration. Each package has a four-line `vitest.config.ts` that
 * merges this, so `pnpm test` works both at the root and inside any package —
 * which is what lets Turborepo cache test results per package.
 *
 * Workspace packages resolve to their TypeScript SOURCE via an alias rather than
 * `resolve.conditions: ["source"]`: that condition is not ours alone (several
 * published packages declare a `"source"` entry pointing at their own `.ts` files,
 * which Node then refuses to strip under node_modules). Aliasing only the
 * `@docture/*` scope keeps the rewrite to code we own, and keeps a stale `dist/`
 * from silently deciding a test run.
 *
 * Relies on one convention: a package's directory name equals its npm name after
 * the scope (`@docture/loader-pdfjs` → `packages/loader-pdfjs`).
 */
const packagesDir = fileURLToPath(new URL("./packages/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@docture\/([a-z0-9-]+)$/, replacement: `${packagesDir}$1/src/index.ts` }],
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
