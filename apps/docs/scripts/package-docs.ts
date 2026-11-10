import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { source, getPageMarkdown } from "../lib/source";
import { llmsArea, llmsIndex, llmsTasks } from "../lib/llms-index";
import { hasUnreleasedChanges, publishedPackageFolders } from "../lib/release";
import symbols from "../public/api-symbols.json";
import { isExternalLink, localLinkTarget, markdownReferences, offlineLink, rewriteMarkdownLinks, validateDocumentationLinks } from "./package-docs-markdown";

const run = promisify(execFile);
const packageManifest = z.object({ name: z.string(), version: z.string() });
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export interface DocumentationRelease {
  readonly packageVersion: string;
  readonly packages: Readonly<Record<string, string>>;
  readonly releaseStatus: "unreleased" | "release";
  readonly sourceRevision: string | null;
  readonly sourceDirty: boolean | null;
}

export async function documentationRelease(root: string, requireRelease: boolean): Promise<DocumentationRelease> {
  const manifests = await Promise.all(publishedPackageFolders.map(async (name) =>
    packageManifest.parse(JSON.parse(await readFile(join(root, "packages", name, "package.json"), "utf8")))));
  const primary = manifests.find((manifest) => manifest.name === "docture");
  if (primary === undefined) throw new Error("The documentation release requires the docture package");
  if (manifests.some((manifest) => manifest.version !== primary.version)) throw new Error("The four Docture packages must have matching versions before building documentation");
  const pending = hasUnreleasedChanges(root);
  let sourceRevision: string | null = null;
  let sourceDirty: boolean | null = null;
  try {
    const [revision, status, prefix] = await Promise.all([
      run("git", ["rev-parse", "HEAD"], { cwd: root }),
      run("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root }),
      run("git", ["rev-parse", "--show-prefix"], { cwd: root }),
    ]);
    if (prefix.stdout.trim() === "") {
      sourceRevision = revision.stdout.trim();
      sourceDirty = status.stdout.trim() !== "";
    }
  }
  catch {}
  if (requireRelease && pending) throw new Error("A package changelog has an Unreleased section. Run pnpm version-packages <version> before releasing.");
  if (requireRelease && sourceRevision === null) throw new Error("Released documentation requires a Git source revision.");
  if (requireRelease && sourceDirty) throw new Error("Released documentation requires a clean checkout. Commit the source and version changes before releasing.");
  return {
    packageVersion: primary.version,
    packages: Object.fromEntries(manifests.sort((a, b) => compare(a.name, b.name)).map((manifest) => [manifest.name, manifest.version])),
    releaseStatus: pending || sourceRevision === null || sourceDirty ? "unreleased" : "release",
    sourceRevision,
    sourceDirty,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function packageDocumentation(options: {
  readonly root: string;
  readonly source: typeof source;
  readonly render: typeof getPageMarkdown;
  readonly release: DocumentationRelease;
}): Promise<Map<string, string>> {
  const { root, source, render, release } = options;
  const contentRoot = join(root, "apps/docs/content/docs");
  const pages = source.getPages().map((page) => {
    const path = relative(contentRoot, page.data.info.fullPath).split(sep).join("/").replace(/\.mdx?$/, ".md");
    if (path.startsWith("../") || !path.endsWith(".md")) throw new Error(`Unexpected documentation source: ${page.data.info.fullPath}`);
    return { page, path };
  }).sort((a, b) => compare(a.path, b.path));
  const routes = new Map<string, string>([["/llms.txt", "llms.txt"], ["/llms-tasks.txt", "llms-tasks.txt"], ["/api-symbols.json", "api-symbols.json"]]);
  for (const { page, path } of pages) {
    if (routes.has(page.url)) throw new Error(`Duplicate documentation route: ${page.url}`);
    routes.set(page.url, path);
    routes.set(`${page.url}.md`, path);
  }
  const tree = source.getPageTree();
  const areas = tree.children.flatMap((node) => node.type === "folder" && node.index !== undefined ? [node.index.url.split("/")[2] ?? ""] : []);
  for (const area of areas) routes.set(`/llms/${area}.txt`, `llms/${area}.txt`);
  const files = new Map<string, string>();
  files.set("LICENSE", await readFile(join(root, "LICENSE"), "utf8"));
  for (const name of (await readdir(join(root, "apps/docs/public/schemas"))).sort()) {
    if (!name.endsWith(".schema.json")) continue;
    const path = `schemas/${name}`;
    const contents = await readFile(join(root, "apps/docs/public", path), "utf8");
    JSON.parse(contents);
    files.set(path, contents);
    routes.set(`/${path}`, path);
  }
  const link = (from: string) => (url: string) => offlineLink({ url, from, routes, revision: release.sourceRevision });
  const label = `${release.packageVersion}${release.releaseStatus === "unreleased" ? " (unreleased checkout)" : ""}`;
  const inventory = [];
  for (const { page, path } of pages) {
    const sourcePath = relative(root, page.data.info.fullPath).split(sep).join("/");
    const markdown = await render(page, {
      release: label,
      revision: release.sourceRevision ?? "unavailable",
      sourceUrl: () => release.sourceRevision === null ? sourcePath : `https://github.com/YasielCabrera/docture/blob/${release.sourceRevision}/${sourcePath}`,
    });
    const output = rewriteMarkdownLinks(markdown, link(path));
    files.set(path, output);
    inventory.push({ path, title: page.data.title, description: page.data.description ?? "", type: page.data.type, tasks: page.data.tasks, source: sourcePath, sha256: sha256(output) });
  }
  const byUrl = new Map(pages.map(({ page }) => [page.url, page.data]));
  const indexOptions = { tree, page: (url: string) => byUrl.get(url), release: label, bulk: false };
  files.set("llms.txt", llmsIndex({ ...indexOptions, link: link("llms.txt") }));
  files.set("llms-tasks.txt", llmsTasks({ ...indexOptions, link: link("llms-tasks.txt") }));
  for (const area of areas) {
    const path = `llms/${area}.txt`;
    const index = llmsArea({ ...indexOptions, link: link(path) }, area);
    if (index === undefined) throw new Error(`Missing documentation area: ${area}`);
    files.set(path, index);
  }
  const localSymbols = symbols.map((symbol) => ({ ...symbol, url: link("api-symbols.json")(symbol.url) }));
  files.set("api-symbols.json", json(localSymbols));
  validateDocumentationLinks(files);
  for (const symbol of localSymbols) {
    if (isExternalLink(symbol.url)) throw new Error(`API reference is not local: ${symbol.symbol}`);
    const target = localLinkTarget(symbol.url, "api-symbols.json");
    const page = files.get(target.path);
    if (page === undefined || target.anchor && !markdownReferences(page).anchors.has(target.anchor)) throw new Error(`Missing API reference: ${symbol.symbol} at ${symbol.url}`);
  }
  const entries = [...files].sort(([a], [b]) => compare(a, b));
  const manifest = { schemaVersion: 1, packageName: "docture", ...release, index: "llms.txt", tasks: "llms-tasks.txt", symbols: "api-symbols.json", pages: inventory, files: entries.map(([path, contents]) => ({ path, sha256: sha256(contents) })) };
  return new Map([...entries, ["manifest.json", json(manifest)]]);
}

export async function writeDocumentation(output: string, files: ReadonlyMap<string, string>): Promise<void> {
  const directory = resolve(output);
  await mkdir(dirname(directory), { recursive: true });
  const staging = await mkdtemp(join(dirname(directory), `.${basename(directory)}-`));
  let previous: string | undefined;
  try {
    for (const [path, contents] of files) {
      const file = resolve(staging, path);
      if (!file.startsWith(`${staging}${sep}`)) throw new Error(`Documentation output leaves its directory: ${path}`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    }
    let existing: string[];
    try { existing = await readdir(directory); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      existing = [];
    }
    if (existing.length > 0) {
      z.object({ schemaVersion: z.literal(1), packageName: z.literal("docture") }).parse(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
      previous = await mkdtemp(join(dirname(directory), `.${basename(directory)}-previous-`));
      await rm(previous, { recursive: true });
      await rename(directory, previous);
    } else await rm(directory, { recursive: true, force: true });
    try { await rename(staging, directory); }
    catch (error) {
      if (previous !== undefined) await rename(previous, directory);
      throw error;
    }
    if (previous !== undefined) await rm(previous, { recursive: true, force: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
