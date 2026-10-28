import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "packages/docture/src");
const manifest = JSON.parse(await readFile(join(root, "packages/docture/package.json"), "utf8"));
const failures = [];

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.(?:[cm]?ts|tsx)$/.test(path)) result.push(path);
  }
  return result;
}

const llmRoles = {
  "llm/tool": "llm/tool",
  "llm/cache": "llm/helpers",
  "llm/citations": "llm/helpers",
  "llm/entries/cache": "llm/helpers",
  "llm/evidence": "llm/helpers",
  "llm/fold": "llm/helpers",
  "llm/merge": "llm/helpers",
  "llm/pricing": "llm/helpers",
  "llm/prompt": "llm/helpers",
  "llm/relax": "llm/helpers",
  "llm/repair": "llm/helpers",
  "llm/failure": "llm/shared",
  "llm/model-id": "llm/shared",
  "llm/request": "llm/shared",
  "llm/telemetry": "llm/shared",
  "llm/strategy": "llm/text",
  "llm/text": "llm/text",
  "llm/vision": "llm/vision",
  "llm/classifier": "llm/classifier",
  "llm/layout": "llm/layout",
  "llm/split": "llm/split",
  "llm/extractor": "llm/extractor",
  "llm/llm": "llm/convenience",
  "llm/index": "llm/convenience",
};
const capabilities = ["llm/tool","llm/text", "llm/vision", "llm/classifier", "llm/layout", "llm/split"];
const reach = {
  "sources/paperless": ["paperless"],
  "sinks/paperless": ["paperless"],
  "loaders/docling": ["import/docling"],
  "llm/shared": ["llm/helpers"],
  ...Object.fromEntries(capabilities.map(capability => [capability, ["llm/helpers", "llm/shared"]])),
  "llm/extractor": ["llm/helpers", "llm/shared", "llm/text", "llm/classifier", "llm/vision"],
  "llm/convenience": ["llm/helpers", "llm/shared", "llm/extractor", ...capabilities],
  "testing/conformance": ["testing/fixtures"],
};
// Reachable only through `import type`, `export type`, or `import("...")` types. Under verbatimModuleSyntax an
// inline `{ type X }` specifier still emits a runtime `import {} from`, so it does not count.
const typeReach = {
  "testing/fixtures": ["eval"],
};

function area(path) {
  const parts = path.split("/");
  if (parts[0] === "llm") return llmRoles[path.replace(/\.(?:[cm]?[jt]s|tsx)$/, "")] ?? "llm/unassigned";
  return ["loaders", "raster", "testing", "inputs", "import", "sources", "sinks"].includes(parts[0]) ? parts.slice(0, 2).join("/") : parts[0];
}

const engines = {
  "llm/tool": ["ai"],
  "llm/shared": ["ai"],
  "llm/text": ["ai"],
  "llm/vision": ["ai"],
  "llm/classifier": ["ai", "zod"],
  "llm/layout": ["ai", "zod"],
  "llm/split": ["ai", "zod"],
  "llm/extractor": ["ai"],
  "llm/convenience": ["ai"],
  "loaders/mammoth": ["mammoth"],
  "inputs/email": ["postal-mime"],
  "loaders/pdfjs": ["pdfjs-dist"],
  "loaders/mupdf": ["mupdf"],
  "loaders/tesseract": ["tesseract.js"],
  "loaders/paddleocr": ["ppu-paddle-ocr", "onnxruntime-node", "utif2"],
  "raster/canvas": ["pdfjs-dist", "@napi-rs/canvas"],
  "testing/fixtures": ["pdfkit"],
  "testing/conformance": ["vitest"],
};

for (const path of await files(source)) {
  const name = relative(source, path);
  const owner = area(name);
  if (owner === "llm/unassigned") failures.push(`${name} has no LLM module role; assign one in scripts/check-boundaries.mjs`);
  if (name.endsWith(".cts")) failures.push(`${name}: CommonJS source .cts is not supported; use ESM .ts or .mts`);
  const code = await readFile(path, "utf8");
  const specifiers = new Map();
  const add = (value, typeOnly) => specifiers.set(value, (specifiers.get(value) ?? true) && typeOnly);
  const tree = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  for (const reference of tree.typeReferenceDirectives) add(reference.fileName, false);
  for (const reference of tree.referencedFiles) {
    const value = reference.fileName;
    add(value.startsWith(".") || isAbsolute(value) ? value : `./${value}`, false);
  }
  for (const diagnostic of tree.parseDiagnostics) {
    failures.push(`${name} cannot be parsed by the boundary checker: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  function check(value, typeOnly) {
    if (value.startsWith(".")) {
      const target = relative(source, resolve(dirname(path), value));
      const targetArea = area(target);
      const allowed = owner === "index.ts"
        ? targetArea === "core"
        : targetArea === owner || targetArea === "core" || (reach[owner] ?? []).includes(targetArea) ||
          typeOnly && (typeReach[owner] ?? []).includes(targetArea);
      if (!allowed) failures.push(`${name} crosses into ${value}`);
      return;
    }
    if (value === "node:module" && !["loaders/pdfjs", "raster/canvas"].includes(owner)) {
      failures.push(`${name} imports node:module outside an engine asset resolver; use ESM imports in shared modules`);
      return;
    }
    if (value.startsWith("node:")) {
      if (["core", "chunk"].includes(owner)) failures.push(`${name} imports a Node built-in from a portable entry`);
      return;
    }
    const dependencies = [
      ...(owner === "core" || owner.startsWith("llm/") ? ["@ai-sdk/provider-utils"] : []),
      ...(name === "core/loaders/html.ts" ? ["parse5", "htmlparser2", "entities"] : []),
      ...(engines[owner] ?? []),
    ];
    if (!dependencies.some(dependency => value === dependency || value.startsWith(`${dependency}/`))) {
      failures.push(`${name} imports undeclared boundary ${value}`);
    }
  }
  function visit(node) {
    if (ts.hasPossibleExternalModuleReference(node)) {
      const specifier = ts.getExternalModuleName(node);
      const typeOnly = ts.isImportTypeNode(node) ||
        ts.isImportDeclaration(node) && node.importClause?.isTypeOnly === true ||
        ts.isExportDeclaration(node) && node.isTypeOnly;
      if (specifier && ts.isStringLiteralLike(specifier)) add(specifier.text, typeOnly);
    }
    if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require" ||
      ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "require" && node.expression.name.text === "resolve"
    )) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0].text, false);
      else failures.push(`${name} uses a computed module specifier that bundlers cannot isolate`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const [specifier, typeOnly] of specifiers) check(specifier, typeOnly);
}

assert.deepEqual(Object.keys(manifest.dependencies), ["@ai-sdk/provider-utils", "@types/json-schema", "entities", "htmlparser2", "parse5"]);
assert.equal(manifest.sideEffects, false);
assert.equal(Object.keys(manifest.exports).some(key => key.includes("*")), false);
for (const engine of new Set(Object.values(engines).flat())) {
  assert.ok(manifest.peerDependencies[engine], `${engine} must be a peer dependency`);
  assert.equal(manifest.peerDependenciesMeta[engine]?.optional, true, `${engine} must be optional`);
}
for (const [key, entry] of Object.entries(manifest.exports)) {
  const stem = entry.source.replace(/^\.\/src\//, "").replace(/\.ts$/, "");
  assert.equal(entry.types, `./dist/${stem}.d.ts`, `${key} declaration path`);
  const runtime = entry.node ?? entry;
  assert.equal(runtime.import, `./dist/${stem}.js`, `${key} ESM path`);
  assert.equal(runtime.default, runtime.import, `${key} fallback path`);
  if (key === "./node") assert.equal(entry.default, undefined, "filesystem entry has no portable fallback");
  await readFile(join(root, "packages/docture", entry.source));
}
const testConfig = JSON.parse(await readFile(join(root, "packages/docture/tsconfig.test.json"), "utf8"));
assert.deepEqual(testConfig.compilerOptions.paths, Object.fromEntries(
  Object.entries(manifest.exports).map(([key, entry]) => [key === "." ? "docture" : `docture${key.slice(1)}`, [entry.source]]),
), "Test source paths must match the public export map");
const packages = [];
for (const folder of await readdir(join(root, "packages"))) {
  const value = JSON.parse(await readFile(join(root, "packages", folder, "package.json"), "utf8"));
  if (!value.private) packages.push(value.name);
}
assert.deepEqual(packages.sort(), ["@docture/cli", "docture"]);

const cliSource = join(root, "packages/cli/src");
const cliManifest = JSON.parse(await readFile(join(root, "packages/cli/package.json"), "utf8"));
const cliPeers = Object.keys(cliManifest.peerDependencies ?? {});
const isCliPeer = specifier => cliPeers.some(peer => specifier === peer || specifier.startsWith(`${peer}/`));
const cliStaticImports = new Map();
for (const path of await files(cliSource)) {
  const name = relative(cliSource, path);
  const tree = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
  const local = [];
  function visitCli(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly;
      if (!typeOnly && specifier.startsWith(".")) local.push(relative(cliSource, resolve(dirname(path), specifier)).replace(/\.js$/, ".ts"));
      if (!typeOnly && isCliPeer(specifier)) failures.push(`cli/${name} statically imports the optional peer ${specifier}; load it through importEngine`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      if (isCliPeer(node.arguments[0].text) && !name.startsWith("mcp/")) failures.push(`cli/${name} loads ${node.arguments[0].text} outside src/mcp`);
    }
    ts.forEachChild(node, visitCli);
  }
  visitCli(tree);
  cliStaticImports.set(name, local);
}
const cliRoot = new Set();
for (const queue = ["index.ts"]; queue.length > 0;) {
  const name = queue.pop();
  if (cliRoot.has(name)) continue;
  cliRoot.add(name);
  queue.push(...(cliStaticImports.get(name) ?? []));
}
for (const name of ["mcp/index.ts", "mcp/server.ts"]) {
  if (cliRoot.has(name)) failures.push(`@docture/cli statically reaches cli/${name}; keep the MCP server behind the lazy mcp command`);
}
const cliRanges = /ENGINE_RANGES = (\{[\s\S]*?\}) as const/.exec(await readFile(join(cliSource, "mcp/engines.ts"), "utf8"))?.[1];
assert.deepEqual(Function(`return ${cliRanges}`)(), cliManifest.peerDependencies, "CLI ENGINE_RANGES must equal its declared peers");
for (const peer of cliPeers) assert.equal(cliManifest.peerDependenciesMeta?.[peer]?.optional, true, `${peer} must be an optional CLI peer`);
assert.deepEqual(Object.keys(cliManifest.exports), [".", "./config", "./mcp", "./service"]);
const configEntry = ts.createSourceFile("define-config.ts", await readFile(join(cliSource, "define-config.ts"), "utf8"), ts.ScriptTarget.Latest, true);
for (const node of configEntry.statements) {
  const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : ts.isExportDeclaration(node) ? node.isTypeOnly : true;
  if (!typeOnly) failures.push("@docture/cli/config must import and re-export types only, so reading a config loads no CLI or docture module");
}

assert.deepEqual(failures, [], "Public module boundaries must stay isolated");
console.log(`Verified two publications and ${Object.keys(manifest.exports).length} isolated ESM entries.`);
