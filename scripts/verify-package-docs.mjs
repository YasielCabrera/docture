import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";

export async function verifyPackedDocumentation(packageDirectory, versions) {
  const directory = join(packageDirectory, "docs");
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packageName, "docture");
  assert.equal(manifest.packageVersion, versions.docture);
  assert.deepEqual(manifest.packages, versions, "docs identify every exact package version they describe");
  assert.ok(["unreleased", "release"].includes(manifest.releaseStatus));
  if (manifest.releaseStatus === "release") {
    assert.match(manifest.sourceRevision, /^[a-f0-9]{40,64}$/);
    assert.equal(manifest.sourceDirty, false);
  }
  assert.equal(manifest.index, "llms.txt");
  assert.equal(manifest.tasks, "llms-tasks.txt");
  assert.equal(manifest.symbols, "api-symbols.json");
  assert.match(await readFile(join(directory, "LICENSE"), "utf8"), /^MIT License\n/);
  const paths = manifest.files.map(file => file.path);
  assert.deepEqual(paths, [...new Set(paths)].sort(), "artifact paths are unique and sorted");
  for (const file of manifest.files) {
    assert.ok(!file.path.startsWith("/") && !file.path.includes("\\") && !file.path.split("/").includes(".."), `artifact path stays local: ${file.path}`);
    const content = await readFile(join(directory, file.path));
    assert.equal(createHash("sha256").update(content).digest("hex"), file.sha256, `packed content hash: ${file.path}`);
  }
  async function files(at = "") {
    const result = [];
    for (const entry of await readdir(join(directory, at), { withFileTypes: true })) {
      const path = posix.join(at, entry.name);
      if (entry.isDirectory()) result.push(...await files(path));
      else {
        assert.ok(entry.isFile(), `documentation has no symlink or special file: ${path}`);
        result.push(path);
      }
    }
    return result;
  }
  assert.deepEqual((await files()).sort(), [...paths, "manifest.json"].sort(), "tarball contains the complete artifact and no stale files");
  assert.ok(manifest.pages.length > 0);
  for (const page of manifest.pages) {
    assert.match(page.path, /\.md$/);
    assert.equal(manifest.files.find(file => file.path === page.path)?.sha256, page.sha256);
  }
  for (const area of ["extraction", "conversion", "evaluation", "synthetic", "cli", "integrations", "resources"]) {
    assert.ok(manifest.pages.some(page => page.path.startsWith(`${area}/`)), `all ${area} guides ship in docture`);
    assert.ok(paths.includes(`llms/${area}.txt`));
  }
  const quickStart = await readFile(join(directory, "extraction/quick-start.md"), "utf8");
  assert.ok(quickStart.includes("makeInvoicePdf") && quickStart.includes("new Extractor"), "installed tutorials include executable source examples");
  assert.ok(!quickStart.includes("<SourceExample"), "installed tutorials do not need a component renderer");
  assert.ok(quickStart.includes('title="make-invoice.mts"'), "installed examples retain their displayed filenames");
  const symbols = JSON.parse(await readFile(join(directory, manifest.symbols), "utf8"));
  for (const symbol of symbols) {
    assert.equal(symbol.markdownUrl, symbol.url, "both symbol destinations resolve to the same offline Markdown contract");
    const target = new URL(symbol.url, "file:///docs/");
    assert.ok(target.href.startsWith("file:///docs/"), `symbol reference stays in the bundle: ${symbol.symbol}`);
    assert.ok(paths.includes(decodeURIComponent(target.pathname.slice("/docs/".length))), `symbol has an installed page: ${symbol.symbol}`);
  }
  return { pages: manifest.pages.length, files: paths.length, packageVersions: manifest.packages, sourceRevision: manifest.sourceRevision, sourceDirty: manifest.sourceDirty, releaseStatus: manifest.releaseStatus };
}

export function documentationConsumer(packageName = "docture") {
  return `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
globalThis.fetch = () => { throw new Error("Documentation must work without network access"); };
const owner = ${JSON.stringify(packageName)};
const manifestUrl = owner === "docture"
  ? new URL(import.meta.resolve("docture/docs/manifest.json"))
  : pathToFileURL(createRequire(import.meta.resolve(owner)).resolve("docture/docs/manifest.json"));
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const packageManifest = JSON.parse(await readFile(new URL("../package.json", manifestUrl), "utf8"));
assert.equal(manifest.packageVersion, packageManifest.version);
assert.equal(manifest.packages.docture, packageManifest.version);
for (const path of [manifest.index, manifest.tasks, "extraction/quick-start.md", "evaluation/quick-start.md", "synthetic/quick-start.md", "cli/quick-start.md"]) {
  assert.ok((await readFile(new URL(path, manifestUrl), "utf8")).length > 0, path);
}
console.log(JSON.stringify({ owner, version: manifest.packageVersion, manifest: manifestUrl.href }));
`;
}
