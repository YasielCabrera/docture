import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const runtime = JSON.parse(
  readFileSync(new URL("./packages/docture/package.json", import.meta.url), "utf8"),
) as { exports: Record<string, { source: string }> };

// Aliases rather than the "source" export condition: dependencies such as
// eventsource-parser also publish "source" entries, and Node refuses to strip
// TypeScript under node_modules.
export default defineConfig({
  resolve: {
    alias: [
      ...Object.entries(runtime.exports).map(([subpath, entry]) => ({
        find: subpath === "." ? "docture" : `docture${subpath.slice(1)}`,
        replacement: fileURLToPath(new URL(entry.source, new URL("./packages/docture/", import.meta.url))),
      })),
      {
        find: "@docture/cli",
        replacement: fileURLToPath(new URL("./packages/cli/src/index.ts", import.meta.url)),
      },
    ].sort((a, b) => b.find.length - a.find.length),
  },
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
