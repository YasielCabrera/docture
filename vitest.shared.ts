import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function sources(directory: string, name: string): { find: string; replacement: string }[] {
  const manifest = JSON.parse(
    readFileSync(new URL(`./packages/${directory}/package.json`, import.meta.url), "utf8"),
  ) as { exports: Record<string, string | { source: string }> };
  return Object.entries(manifest.exports).flatMap(([subpath, entry]) =>
    typeof entry === "string" ? [] : [{
      find: subpath === "." ? name : `${name}${subpath.slice(1)}`,
      replacement: fileURLToPath(new URL(entry.source, new URL(`./packages/${directory}/`, import.meta.url))),
    }],
  );
}

// Aliases rather than the "source" export condition: dependencies such as
// eventsource-parser also publish "source" entries, and Node refuses to strip
// TypeScript under node_modules.
export default defineConfig({
  resolve: {
    alias: [
      ...sources("docture", "docture"),
      ...sources("eval", "@docture/eval"),
      ...sources("synthetic", "@docture/synthetic"),
      {
        find: "@docture/cli",
        replacement: fileURLToPath(new URL("./packages/cli/src/index.ts", import.meta.url)),
      },
    ].sort((a, b) => b.find.length - a.find.length),
  },
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
