import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { API_INVENTORY, type ApiEntrypointInventory } from "../api-reference.js";
import { checkAdditionalDocs } from "./additional-docs.js";

const ROOT = process.cwd();
const DOCS_ROOT = resolve(ROOT, "content/docs");

const PRESERVED_DOC_ROUTES = [
  "/docs",
  "/docs/concepts/bundles-and-splitters",
  "/docs/concepts/classification",
  "/docs/concepts/contracts",
  "/docs/concepts/loaders",
  "/docs/concepts/rasterizers",
  "/docs/concepts/schemas-and-types",
  "/docs/concepts/strategies",
  "/docs/guides/batches-and-lifecycle",
  "/docs/guides/cli",
  "/docs/guides/custom-loader",
  "/docs/guides/document-conversion",
  "/docs/guides/installation",
  "/docs/guides/long-documents",
  "/docs/guides/measuring-accuracy",
  "/docs/guides/migration",
  "/docs/guides/retrieval-chunks",
  "/docs/guides/routing-and-fallback",
  "/docs/guides/scanned-documents",
  "/docs/guides/sources-and-inputs",
  "/docs/guides/with-a-model",
  "/docs/guides/without-a-model",
  "/docs/how-it-works",
  "/docs/quick-start",
  "/docs/reference/api",
  "/docs/reference/api/cli",
  "/docs/reference/api/core-classification",
  "/docs/reference/api/core-components",
  "/docs/reference/api/core-contracts",
  "/docs/reference/api/core-conversion",
  "/docs/reference/api/core-documents",
  "/docs/reference/api/core-extraction",
  "/docs/reference/api/chunk",
  "/docs/reference/api/eval",
  "/docs/reference/api/llm",
  "/docs/reference/api/llm-utilities",
  "/docs/reference/api/loader-mupdf",
  "/docs/reference/api/loader-paddleocr",
  "/docs/reference/api/loader-pdfjs",
  "/docs/reference/api/loader-tesseract",
  "/docs/reference/api/raster-canvas",
  "/docs/reference/api/testing",
  "/docs/reference/architecture",
  "/docs/reference/errors",
  "/docs/reference/packages"
];

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

function listedNames(item: ApiEntrypointInventory): string[] {
  return Object.values(item.pages).flat().sort();
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

async function checkApiCoverage(): Promise<ts.Program> {
  const entrypoints = API_INVENTORY.map((item) => resolve(ROOT, item.entrypoint));
  const program = ts.createProgram(entrypoints, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
  });

  for (const item of API_INVENTORY) {
    const actual = exportedNames(item.entrypoint, program);
    compareNames(item.importPath, actual, listedNames(item));

    for (const [page, names] of Object.entries(item.pages)) {
      const path = resolve(ROOT, page);
      if (!existsSync(path)) {
        fail(`${item.importPath}: assigned API page does not exist: ${page}`);
        continue;
      }
      const source = await readFile(path, "utf8");
      for (const name of names) {
        const exact = new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`);
        if (!exact.test(source)) fail(`${item.importPath}: ${name} is absent from ${page}`);
      }
    }
  }

  const manifestSchema = z.object({
    name: z.string(),
    private: z.boolean().optional(),
    exports: z.record(z.string(), z.object({ source: z.string() })).optional(),
  });
  const packagesRoot = resolve(ROOT, "../../packages");
  const packageDirectories = await readdir(packagesRoot, { withFileTypes: true });
  const published = new Set<string>();
  const exportedPaths = new Set<string>();
  const byImportPath = new Map(API_INVENTORY.map((item) => [item.importPath, item]));
  if (byImportPath.size !== API_INVENTORY.length) fail("API inventory repeats a public import path");

  for (const directory of packageDirectories.filter((entry) => entry.isDirectory())) {
    const packageRoot = join(packagesRoot, directory.name);
    const file = join(packageRoot, "package.json");
    if (!existsSync(file)) continue;
    const manifest = manifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
    if (manifest.private === true) continue;
    published.add(manifest.name);

    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const importPath = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
      exportedPaths.add(importPath);
      const item = byImportPath.get(importPath);
      if (item === undefined) {
        fail(`Public entry point is missing from the API inventory: ${importPath}`);
      } else if (item.packageName !== manifest.name || resolve(ROOT, item.entrypoint) !== resolve(packageRoot, target.source)) {
        fail(`${importPath}: API inventory does not match its package export source ${target.source}`);
      }
    }
  }

  compareNames("Published packages", [...published].sort(), ["@docture/cli", "docture"]);
  for (const item of API_INVENTORY) {
    if (!exportedPaths.has(item.importPath)) fail(`API inventory contains an unsupported import path: ${item.importPath}`);
  }
  return program;
}

async function checkPublicImports(files: readonly string[]): Promise<number> {
  const byImportPath = new Map(API_INVENTORY.map((item) => [item.importPath, new Set(listedNames(item))]));
  let count = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
      const importPath = match[2] ?? "";
      if (importPath !== "docture" && !importPath.startsWith("docture/") && !importPath.startsWith("@docture/")) continue;
      count += 1;
      const names = byImportPath.get(importPath);
      const location = relative(ROOT, file);
      if (names === undefined) {
        fail(`${location}: unsupported public import ${importPath}`);
        continue;
      }
      for (const specifier of (match[1] ?? "").split(",")) {
        const name = specifier.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0] ?? "";
        if (name !== "" && !names.has(name)) fail(`${location}: ${name} is not exported by ${importPath}`);
      }
    }
  }
  return count;
}

async function checkInstallRecipes(files: readonly string[]): Promise<number> {
  const library = z
    .object({ peerDependencies: z.record(z.string(), z.string()), devDependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(await readFile(resolve(ROOT, "../../packages/docture/package.json"), "utf8")));
  let count = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const command of source.matchAll(/\b(?:npm (?:install|i)|pnpm add|yarn add)\b[^`"\n]*/g)) {
      count += 1;
      for (const [, name = "", version = ""] of command[0].matchAll(/(?<![\w@/-])((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+)(?![\w.-])/g)) {
        const developed = library.devDependencies[name];
        if (name in library.peerDependencies && version !== developed) {
          fail(`${relative(ROOT, file)}: ${name}@${version} in an install command differs from the development version ${developed}`);
        }
      }
    }
  }
  return count;
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
const program = await checkApiCoverage();
for (const failure of await checkAdditionalDocs(resolve(ROOT, "../.."), program)) fail(failure);
const importCount = await checkPublicImports([
  ...files,
  ...await walk(resolve(ROOT, "examples"), ".ts"),
  ...await walk(resolve(ROOT, "components"), ".tsx"),
  resolve(ROOT, "scripts/generate-hero-document.ts"),
  resolve(ROOT, "../../README.md"),
  resolve(ROOT, "../../packages/docture/README.md"),
  resolve(ROOT, "../../packages/cli/README.md"),
]);
const examples = resolve(ROOT, "../examples");
const exampleReadmes = [
  join(examples, "README.md"),
  ...(await readdir(examples, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => join(examples, entry.name, "README.md"))
    .filter((file) => existsSync(file)),
];
const recipeCount = await checkInstallRecipes([
  ...files,
  ...await walk(resolve(ROOT, "components"), ".tsx"),
  resolve(ROOT, "../../README.md"),
  resolve(ROOT, "../../packages/docture/README.md"),
  resolve(ROOT, "../../packages/cli/README.md"),
  ...exampleReadmes,
]);
await checkLinksAndExamples(files);
await checkProse(files);

if (failures.length > 0) {
  console.error(`Documentation checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const packages = new Set(API_INVENTORY.map((item) => item.packageName));
  console.log(`Documentation checks passed: ${files.length} pages, ${packages.size} packages, ${API_INVENTORY.length} public entry points, ${importCount} public imports, ${recipeCount} install commands.`);
}
