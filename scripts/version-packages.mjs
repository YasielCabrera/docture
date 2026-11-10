import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (version === undefined || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm version-packages <version>, for example pnpm version-packages 0.3.0");
  process.exit(1);
}

for (const folder of ["docture", "cli", "eval", "synthetic"]) {
  const manifest = new URL(`../packages/${folder}/package.json`, import.meta.url);
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(/^(  "version": ")[^"]+/m, `$1${version}`));
  const changelog = new URL(`../packages/${folder}/CHANGELOG.md`, import.meta.url);
  writeFileSync(changelog, readFileSync(changelog, "utf8").replace(/^## Unreleased$/m, `## ${version}`));
}
