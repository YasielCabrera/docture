import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { register } from "fumadocs-mdx/node";
import { documentationRelease, packageDocumentation, writeDocumentation } from "./package-docs";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(docsRoot, "../..");
const { values } = parseArgs({ options: { output: { type: "string" }, release: { type: "boolean" } } });
const output = resolve(values.output ?? join(root, "packages/docture/docs"));
const release = await documentationRelease(root, values.release ?? false);
const loaderOutput = await mkdtemp(join(docsRoot, ".source-package-"));
process.chdir(docsRoot);
try {
  register({ outDir: loaderOutput });
  const { source, getPageMarkdown } = await import("../lib/source");
  const files = await packageDocumentation({ root, source, render: getPageMarkdown, release });
  if (values.release && JSON.stringify(await documentationRelease(root, true)) !== JSON.stringify(release)) {
    throw new Error("Documentation source changed during the release build. Build again from a clean checkout.");
  }
  await writeDocumentation(output, files);
  console.log(`Built documentation for docture ${release.packageVersion}: ${source.getPages().length} pages in ${output}`);
} finally {
  await rm(loaderOutput, { recursive: true, force: true });
}
