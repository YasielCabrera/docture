import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { API_INVENTORY, type ApiPackageInventory } from "../api-reference.js";

const ROOT = process.cwd();
const DOCS_ROOT = resolve(ROOT, "content/docs");

const PRESERVED_DOC_ROUTES = [
  "/docs",
  "/docs/quick-start",
  "/docs/how-it-works",
  "/docs/guides/with-a-model",
  "/docs/guides/without-a-model",
  "/docs/guides/scanned-documents",
  "/docs/guides/long-documents",
  "/docs/guides/custom-loader",
  "/docs/guides/measuring-accuracy",
  "/docs/guides/cli",
  "/docs/concepts/contracts",
  "/docs/concepts/schemas-and-types",
  "/docs/concepts/loaders",
  "/docs/concepts/rasterizers",
  "/docs/concepts/strategies",
  "/docs/concepts/classification",
  "/docs/concepts/bundles-and-splitters",
  "/docs/reference/packages",
  "/docs/reference/errors",
  "/docs/reference/architecture",
] as const;

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

async function walk(directory: string, extension: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path, extension);
      return extname(entry.name) === extension ? [path] : [];
    }),
  );
  return files.flat().sort();
}

function routeFor(file: string): string {
  const path = relative(DOCS_ROOT, file).split(sep).join("/").replace(/\.mdx$/, "");
  if (path === "index") return "/docs";
  return `/docs/${path.replace(/\/index$/, "")}`;
}

function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function anchorsOf(source: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const match of source.matchAll(/^#{2,6}\s+(.+)$/gm)) {
    const base = slugifyHeading(match[1] ?? "");
    if (base === "") continue;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function exportedNames(entrypoint: string, program: ts.Program): string[] {
  const file = resolve(ROOT, entrypoint);
  const source = program.getSourceFile(file);
  if (source === undefined) {
    fail(`API entry point does not exist in the TypeScript program: ${entrypoint}`);
    return [];
  }
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  if (module === undefined) {
    fail(`Could not read exports from ${entrypoint}`);
    return [];
  }
  return checker
    .getExportsOfModule(module)
    .map((symbol) => symbol.getName())
    .filter((name) => name !== "default")
    .sort();
}

function listedNames(item: ApiPackageInventory): string[] {
  return Object.values(item.pages ?? {}).flat().sort();
}

function compareNames(packageName: string, actual: string[], listed: string[]): void {
  const actualSet = new Set(actual);
  const listedSet = new Set(listed);
  for (const name of actual) {
    if (!listedSet.has(name)) fail(`${packageName}: public export is missing from the API inventory: ${name}`);
  }
  for (const name of listed) {
    if (!actualSet.has(name)) fail(`${packageName}: stale API inventory entry: ${name}`);
  }
  if (listedSet.size !== listed.length) {
    fail(`${packageName}: one or more API exports are assigned more than once`);
  }
}

async function checkApiCoverage(): Promise<void> {
  const entrypoints = API_INVENTORY.map((item) => resolve(ROOT, item.entrypoint));
  const program = ts.createProgram(entrypoints, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
  });

  const byPackage = new Map(API_INVENTORY.map((item) => [item.packageName, item]));
  const namesByPackage = new Map<string, string[]>();

  for (const item of API_INVENTORY) {
    const actual = exportedNames(item.entrypoint, program);
    namesByPackage.set(item.packageName, actual);
    if (item.mirrors === undefined) compareNames(item.packageName, actual, listedNames(item));

    for (const [page, names] of Object.entries(item.pages ?? {})) {
      const path = resolve(ROOT, page);
      if (!existsSync(path)) {
        fail(`${item.packageName}: assigned API page does not exist: ${page}`);
        continue;
      }
      const source = await readFile(path, "utf8");
      for (const name of names) {
        const exact = new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`);
        if (!exact.test(source)) fail(`${item.packageName}: ${name} is absent from ${page}`);
      }
    }
  }

  for (const item of API_INVENTORY) {
    if (item.mirrors === undefined) continue;
    const expected = [
      ...new Set(
        item.mirrors.flatMap((name) => {
          if (!byPackage.has(name)) fail(`${item.packageName}: unknown mirrored package ${name}`);
          return namesByPackage.get(name) ?? [];
        }),
      ),
    ].sort();
    compareNames(item.packageName, namesByPackage.get(item.packageName) ?? [], expected);
  }

  const packageFiles = await walk(resolve(ROOT, "../../packages"), ".json");
  const published = new Set<string>();
  for (const file of packageFiles.filter((file) => basename(file) === "package.json")) {
    const manifest = JSON.parse(await readFile(file, "utf8")) as { name?: string; private?: boolean };
    if (manifest.private !== true && manifest.name !== undefined) published.add(manifest.name);
  }
  const inventoried = new Set(API_INVENTORY.map((item) => item.packageName));
  for (const name of published) {
    if (!inventoried.has(name)) fail(`Published package is missing from the API inventory: ${name}`);
  }
  for (const name of inventoried) {
    if (!published.has(name)) fail(`API inventory contains an unpublished package: ${name}`);
  }
}

async function checkLinksAndExamples(files: readonly string[]): Promise<void> {
  const byRoute = new Map<string, { file: string; source: string; anchors: Set<string> }>();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    byRoute.set(routeFor(file), { file, source, anchors: anchorsOf(source) });
  }

  for (const route of PRESERVED_DOC_ROUTES) {
    if (!byRoute.has(route)) fail(`Preserved documentation route is missing: ${route}`);
  }

  for (const [route, page] of byRoute) {
    const links = [
      ...page.source.matchAll(/\[[^\]]*\]\((\/docs[^)\s]*)\)/g),
      ...page.source.matchAll(/href=["'](\/docs[^"']*)["']/g),
    ];
    for (const match of links) {
      const raw = match[1] ?? "";
      const [pathWithQuery, anchor] = raw.split("#", 2);
      const path = (pathWithQuery ?? "").split("?", 1)[0]?.replace(/\/$/, "") || "/docs";
      const target = byRoute.get(path);
      if (target === undefined) {
        fail(`${route}: broken internal link ${raw}`);
      } else if (anchor !== undefined && anchor !== "" && !target.anchors.has(anchor)) {
        fail(`${route}: broken anchor ${raw}`);
      }
    }

    for (const match of page.source.matchAll(/<SourceExample\s+file=["']([^"']+)["']/g)) {
      const file = match[1] ?? "";
      const path = resolve(ROOT, "examples", file);
      const examplesRoot = resolve(ROOT, "examples");
      if (!path.startsWith(`${examplesRoot}${sep}`) || !existsSync(path)) {
        fail(`${route}: source example does not exist: ${file}`);
      }
    }
  }
}

function proseOnly(source: string): string {
  return source
    .replace(/^---[\s\S]*?---/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/<[^>]+>/g, "");
}

async function checkProse(files: readonly string[]): Promise<void> {
  const banned = [
    "additionally",
    "boasts",
    "crucial",
    "delve",
    "elevate",
    "enhance",
    "fostering",
    "garner",
    "game-changer",
    "intricate",
    "landscape",
    "leverage",
    "numerous",
    "pivotal",
    "powerful solution",
    "seamlessly",
    "serves as",
    "showcase",
    "stands as",
    "tapestry",
    "testament",
    "underscore",
    "utilize",
    "vibrant",
  ];
  const allowedDiagramRoutes = new Set([
    "/docs/how-it-works",
    "/docs/concepts/bundles-and-splitters",
    "/docs/reference/architecture",
  ]);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const route = routeFor(file);
    const prose = proseOnly(source);
    if (/[—–]/.test(prose)) fail(`${route}: prose contains an em dash or en dash`);
    if (/[“”‘’]/.test(prose)) fail(`${route}: prose contains curly quotation marks`);
    if (/\p{Extended_Pictographic}/u.test(prose)) fail(`${route}: prose contains an emoji`);
    const lower = prose.toLowerCase();
    for (const phrase of banned) {
      if (lower.includes(phrase)) fail(`${route}: prose contains banned phrase "${phrase}"`);
    }

    const diagrams = [...source.matchAll(/```mermaid\b/g)].length;
    if (diagrams > 0 && !allowedDiagramRoutes.has(route)) {
      fail(`${route}: diagrams are limited to the pipeline, bundle, and architecture pages`);
    }
    if (allowedDiagramRoutes.has(route) && diagrams !== 1) {
      fail(`${route}: expected exactly one diagram, found ${diagrams}`);
    }
  }
}

const files = await walk(DOCS_ROOT, ".mdx");
await checkApiCoverage();
await checkLinksAndExamples(files);
await checkProse(files);

if (failures.length > 0) {
  console.error(`Documentation checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation checks passed: ${files.length} pages, ${API_INVENTORY.length} packages.`);
}
