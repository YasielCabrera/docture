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
  "llm/cache": "llm/helpers",
  "llm/entries/cache": "llm/helpers",
  "llm/merge": "llm/helpers",
  "llm/pricing": "llm/helpers",
  "llm/prompt": "llm/helpers",
  "llm/relax": "llm/helpers",
  "llm/failure": "llm/shared",
  "llm/model-id": "llm/shared",
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
const capabilities = ["llm/text", "llm/vision", "llm/classifier", "llm/layout", "llm/split"];
const reach = {
  "llm/shared": ["llm/helpers"],
  ...Object.fromEntries(capabilities.map(capability => [capability, ["llm/helpers", "llm/shared"]])),
  "llm/extractor": ["llm/helpers", "llm/shared", "llm/text", "llm/classifier", "llm/vision"],
  "llm/convenience": ["llm/helpers", "llm/shared", "llm/extractor", ...capabilities],
  "testing/conformance": ["testing/fixtures"],
};

function area(path) {
  const parts = path.split("/");
  if (parts[0] === "llm") return llmRoles[path.replace(/\.(?:[cm]?[jt]s|tsx)$/, "")] ?? "llm/unassigned";
  return ["loaders", "raster", "testing"].includes(parts[0]) ? parts.slice(0, 2).join("/") : parts[0];
}

const engines = {
  "llm/shared": ["ai"],
  "llm/text": ["ai"],
  "llm/vision": ["ai"],
  "llm/classifier": ["ai", "zod"],
  "llm/layout": ["ai", "zod"],
  "llm/split": ["ai", "zod"],
  "llm/extractor": ["ai"],
  "llm/convenience": ["ai"],
  "loaders/pdfjs": ["pdfjs-dist"],
  "loaders/mupdf": ["mupdf"],
  "loaders/tesseract": ["tesseract.js"],
  "loaders/paddleocr": ["ppu-paddle-ocr", "onnxruntime-node"],
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
  const specifiers = new Set();
  const tree = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  for (const reference of tree.typeReferenceDirectives) specifiers.add(reference.fileName);
  for (const reference of tree.referencedFiles) {
    const value = reference.fileName;
    specifiers.add(value.startsWith(".") || isAbsolute(value) ? value : `./${value}`);
  }
  for (const diagnostic of tree.parseDiagnostics) {
    failures.push(`${name} cannot be parsed by the boundary checker: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  function check(value) {
    if (value.startsWith(".")) {
      const target = relative(source, resolve(dirname(path), value));
      const targetArea = area(target);
      const allowed = owner === "index.ts" ? targetArea === "core" : targetArea === owner || targetArea === "core" || (reach[owner] ?? []).includes(targetArea);
      if (!allowed) failures.push(`${name} crosses into ${value}`);
      return;
    }
    if (value === "node:module" && !["loaders/pdfjs", "raster/canvas"].includes(owner)) {
      failures.push(`${name} imports node:module outside an engine asset resolver; use ESM imports in shared modules`);
      return;
    }
    if (value.startsWith("node:")) return;
    const dependencies = owner === "core" ? ["@ai-sdk/provider-utils"] : engines[owner] ?? [];
    if (!dependencies.some(dependency => value === dependency || value.startsWith(`${dependency}/`))) {
      failures.push(`${name} imports undeclared boundary ${value}`);
    }
  }
  function visit(node) {
    if (ts.hasPossibleExternalModuleReference(node)) {
      const specifier = ts.getExternalModuleName(node);
      if (specifier && ts.isStringLiteralLike(specifier)) specifiers.add(specifier.text);
    }
    if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require" ||
      ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "require" && node.expression.name.text === "resolve"
    )) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specifiers.add(node.arguments[0].text);
      else failures.push(`${name} uses a computed module specifier that bundlers cannot isolate`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const specifier of specifiers) check(specifier);
}

assert.deepEqual(Object.keys(manifest.dependencies), ["@ai-sdk/provider-utils", "@types/json-schema"]);
assert.equal(manifest.sideEffects, false);
assert.equal(Object.keys(manifest.exports).some(key => key.includes("*")), false);
for (const engine of new Set(Object.values(engines).flat())) {
  assert.ok(manifest.peerDependencies[engine], `${engine} must be a peer dependency`);
  assert.equal(manifest.peerDependenciesMeta[engine]?.optional, true, `${engine} must be optional`);
}
for (const [key, entry] of Object.entries(manifest.exports)) {
  const stem = entry.source.replace(/^\.\/src\//, "").replace(/\.ts$/, "");
  assert.equal(entry.types, `./dist/${stem}.d.ts`, `${key} declaration path`);
  assert.equal(entry.import, `./dist/${stem}.js`, `${key} ESM path`);
  assert.equal(entry.default, entry.import, `${key} fallback path`);
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
assert.deepEqual(failures, [], "Public module boundaries must stay isolated");
console.log(`Verified two publications and ${Object.keys(manifest.exports).length} isolated ESM entries.`);
