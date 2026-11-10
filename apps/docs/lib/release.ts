import { readFileSync } from "node:fs";
import { join } from "node:path";

export const publishedPackageFolders = ["docture", "cli", "eval", "synthetic"] as const;

export function hasUnreleasedChanges(root: string): boolean {
  return publishedPackageFolders.some((folder) =>
    /^## Unreleased$/m.test(readFileSync(join(root, "packages", folder, "CHANGELOG.md"), "utf8")));
}
