import { readFileSync, writeFileSync } from "node:fs";

const folders = ["docture", "cli", "eval", "synthetic"];
const file = (folder, name) => new URL(`../packages/${folder}/${name}`, import.meta.url);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const changelogs = folders.map((folder) => readFileSync(file(folder, "CHANGELOG.md"), "utf8"));
const unreleased = changelogs.flatMap((changelog) => changelog.match(/^## Unreleased$[^]*?(?=^## |(?![^]))/m) ?? []);
if (unreleased.length === 0) fail("No package changelog has an Unreleased section, so there is nothing to release.");

const requested = process.argv[2] ?? "auto";
let version = requested;
if (requested === "auto" || requested === "minor" || requested === "patch") {
  const bump = requested === "auto"
    ? unreleased.some((section) => /^### (Major|Minor) Changes$/m.test(section)) ? "minor" : "patch"
    : requested;
  const [major, minor, patch] = JSON.parse(readFileSync(file("docture", "package.json"), "utf8")).version
    .split("-")[0].split(".").map(Number);
  version = bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail("Usage: pnpm version-packages [auto|minor|patch|<version>], for example pnpm version-packages 0.3.0");
}

folders.forEach((folder, index) => {
  const manifest = file(folder, "package.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(/^(  "version": ")[^"]+/m, `$1${version}`));
  writeFileSync(file(folder, "CHANGELOG.md"), changelogs[index].replace(/^## Unreleased$/m, `## ${version}`));
});
console.log(version);
