/**
 * The version, read from `package.json` at run time.
 *
 * Not a generated constant and not a build step: `../package.json` resolves to the
 * same file from `src/` and from `dist/`, so the number printed is by construction
 * the number that was published. A generated constant is a thing that can be stale.
 */

import { readFileSync } from "node:fs";

let cached: string | undefined;

export function version(): string {
  if (cached !== undefined) return cached;
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    cached = (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    // Bundled, or read-only, or otherwise not where we left it. A CLI must not
    // fail to run because it could not tell you its own version.
    cached = "0.0.0";
  }
  return cached;
}
