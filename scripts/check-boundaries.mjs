import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, access } from "node:fs/promises";
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
        : targetArea === owner || targetArea === "core" || (reach[owner] ?? []).includes(targetArea);
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
  packages.push(value);
}
assert.deepEqual(packages.map(value => value.name).sort(), ["@docture/cli", "@docture/eval", "@docture/synthetic", "docture"], "Only the four declared packages may exist");
for (const name of ["docture", "@docture/cli", "@docture/synthetic"]) assert.ok(!packages.find(value => value.name === name).private, `${name} must be public`);

const evalSource = join(root, "packages/eval/src");
const evalManifest = packages.find(value => value.name === "@docture/eval");
function evalArea(name) {
  const parts = name.replace(/\.(?:[cm]?[jt]s|tsx)$/, "").split("/");
  if (parts.length === 1) return parts[0] === "config" ? "config" : "root";
  if (["reporters", "adapters"].includes(parts[0])) return parts.slice(0, 2).join("/");
  return ["dataset", "runner", "node", "comparison", "calibration", "grounding", "conversion", "docture", "judge"].includes(parts[0]) ? parts[0] : "root";
}
const evalReach = { runner: ["dataset", "comparison"], node: ["dataset", "runner"], docture: ["runner"] };
const reporterAllowedNodeModules = ["node/artifacts"];
assert.equal(evalManifest.sideEffects, false, "eval declares sideEffects: false");
assert.equal(Object.keys(evalManifest.exports).some(key => key.includes("*")), false, "eval uses explicit exports");
for (const [key, entry] of Object.entries(evalManifest.exports)) {
  if (key.endsWith(".json")) continue;
  const stem = entry.source.replace(/^\.\/src\//, "").replace(/\.ts$/, "");
  assert.equal(entry.types, `./dist/${stem}.d.ts`, `${key} eval declaration path`);
  assert.equal((entry.node ?? entry).import, `./dist/${stem}.js`, `${key} eval ESM path`);
}
assert.ok(evalManifest.peerDependencies?.docture, "eval requires the docture peer");
assert.notEqual(evalManifest.peerDependenciesMeta?.docture?.optional, true, "eval's docture peer is required");
for (const path of await files(evalSource)) {
  const name = relative(evalSource, path);
  const owner = evalArea(name);
  const label = `eval/${name}`;
  const isTest = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?tsx?$/.test(name);
  const tree = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
  if (name.endsWith(".cts")) failures.push(`${label}: CommonJS source .cts is not supported`);
  for (const diagnostic of tree.parseDiagnostics) failures.push(`${label} cannot be parsed by the boundary checker: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  function checkEval(value, typeOnly) {
    if (value.startsWith(".")) {
      const target = relative(evalSource, resolve(dirname(path), value));
      const targetArea = evalArea(target);
      const isReporterEntry = owner.startsWith("reporters/") && owner !== "reporters/shared";
      const allowed = !target.startsWith("..") && (targetArea === "root" || targetArea === owner ||
        (evalReach[owner] ?? []).includes(targetArea) ||
        isReporterEntry && (targetArea === "reporters/shared" || reporterAllowedNodeModules.includes(target.replace(/\.(?:[cm]?[jt]s|tsx)$/, ""))));
      if (!allowed) failures.push(`${label} crosses into ${value}`);
    } else if (value.startsWith("node:")) {
      if (owner !== "node" && !isTest) failures.push(`${label} imports a Node built-in outside node/`);
    } else if (value === "ai" || value.startsWith("ai/")) {
      if (owner !== "judge") failures.push(`${label} imports ai outside judge/`);
    } else if (value === "docture" || value.startsWith("docture/")) {
      if (value.startsWith("docture/llm/") && owner !== "docture") failures.push(`${label} imports docture/llm outside docture/`);
      if (!typeOnly && value !== "docture" && !(owner === "docture" && value === "docture/llm/pricing")) failures.push(`${label} imports runtime docture subpath ${value}`);
    } else failures.push(`${label} imports undeclared boundary ${value}; use relative internal imports`);
  }
  for (const reference of tree.typeReferenceDirectives) checkEval(reference.fileName, false);
  for (const reference of tree.referencedFiles) checkEval(reference.fileName.startsWith(".") ? reference.fileName : `./${reference.fileName}`, false);
  function visitEval(node) {
    if (ts.hasPossibleExternalModuleReference(node)) {
      const specifier = ts.getExternalModuleName(node);
      const typeOnly = ts.isImportTypeNode(node) || ts.isImportDeclaration(node) && node.importClause?.isTypeOnly === true || ts.isExportDeclaration(node) && node.isTypeOnly;
      if (specifier && ts.isStringLiteralLike(specifier)) checkEval(specifier.text, typeOnly);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require" ||
      ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "require" && node.expression.name.text === "resolve")) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) checkEval(node.arguments[0].text, false);
      else failures.push(`${label} uses a computed module specifier that bundlers cannot isolate`);
    }
    ts.forEachChild(node, visitEval);
  }
  visitEval(tree);
}
const exists = path => access(path).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
if (await exists(join(evalSource, "judge"))) {
  const ranges = [];
  for (const path of await files(join(evalSource, "judge"))) {
    const match = /ENGINE_RANGES\s*=\s*(\{[\s\S]*?\}) as const/.exec(await readFile(path, "utf8"));
    if (match) ranges.push(Function(`return ${match[1]}`)());
  }
  assert.equal(ranges.length, 1, "eval judge declares one ENGINE_RANGES table");
  const peers = Object.fromEntries(Object.entries(evalManifest.peerDependencies ?? {}).filter(([name]) => name !== "docture"));
  assert.deepEqual(ranges[0], peers, "eval ENGINE_RANGES must equal its declared engine peers");
  for (const name of Object.keys(peers)) assert.equal(evalManifest.peerDependenciesMeta?.[name]?.optional, true, `${name} must be an optional eval peer`);
}
const htmlBuilder = join(root, "packages/eval/scripts/build-html-client.mjs");
if (await exists(htmlBuilder)) {
  const result = spawnSync(process.execPath, [htmlBuilder, "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `eval HTML client must be fresh: ${result.stdout}${result.stderr}`);
}

const syntheticSource = join(root, "packages/synthetic/src");
const syntheticManifest = packages.find(value => value.name === "@docture/synthetic");
const syntheticEntries = ["pdfkit", "verify", "measure", "degrade", "faker", "llm", "html", "react-pdf", "node"];
const syntheticArea = name => {
  const parts = name.split("/");
  return parts.length > 1 && syntheticEntries.includes(parts[0]) ? parts[0] : "root";
};
// The corpus writer orchestrates rendering, verification and degradation.
const syntheticReach = { node: ["pdfkit", "verify", "degrade"] };
const syntheticEngines = { pdfkit: ["pdfkit"], degrade: ["sharp", "pdfkit"], faker: ["@faker-js/faker"], llm: ["ai"], html: ["playwright-core"], "react-pdf": ["react", "@react-pdf/renderer"] };
const syntheticDocture = { verify: ["docture/loaders/pdfjs"], measure: ["docture/loaders/pdfjs"], degrade: ["docture/raster/canvas", "docture/loaders/pdfjs"], node: ["docture/node"] };
const syntheticPins = ["sharp", "@faker-js/faker", "playwright-core", "@react-pdf/renderer"];
// Docture's packed gate already verifies these engines' floors and newest releases.
const syntheticSharedRanges = ["pdfkit", "pdfjs-dist", "@napi-rs/canvas"];
const syntheticPeers = Object.fromEntries(Object.entries(syntheticManifest.peerDependencies ?? {}).filter(([name]) => name !== "docture"));
const syntheticRanges = new Map();
const syntheticEngineLoads = [];
assert.equal(syntheticManifest.sideEffects, false, "synthetic declares sideEffects: false");
assert.deepEqual(Object.keys(syntheticManifest.dependencies ?? {}), [], "synthetic has no runtime dependencies beyond its peers");
assert.deepEqual(Object.keys(syntheticManifest.exports).sort(), [".", ...syntheticEntries.map(entry => `./${entry}`)].sort(), "synthetic exports the root and one entry per entry folder");
for (const [key, entry] of Object.entries(syntheticManifest.exports)) {
  const stem = entry.source.replace(/^\.\/src\//, "").replace(/\.ts$/, "");
  assert.equal(entry.types, `./dist/${stem}.d.ts`, `${key} synthetic declaration path`);
  const runtime = key === "./node" ? entry.node : entry;
  assert.equal(runtime?.import, `./dist/${stem}.js`, `${key} synthetic ESM path`);
  assert.equal(runtime.default, runtime.import, `${key} synthetic fallback path`);
  if (key === "./node") assert.equal(entry.default, undefined, "the synthetic corpus writer has no portable fallback");
  await readFile(join(root, "packages/synthetic", entry.source));
}
assert.ok(syntheticManifest.peerDependencies?.docture, "synthetic requires the docture peer");
assert.notEqual(syntheticManifest.peerDependenciesMeta?.docture?.optional, true, "synthetic's docture peer is required");
for (const name of Object.keys(syntheticPeers)) assert.equal(syntheticManifest.peerDependenciesMeta?.[name]?.optional, true, `${name} must be an optional synthetic peer`);
for (const name of syntheticPins) {
  assert.match(syntheticPeers[name] ?? "", /^\d+\.\d+\.\d+$/, `${name} stays an exact synthetic pin until the packed gate verifies a range`);
  assert.equal(syntheticManifest.devDependencies?.[name], syntheticPeers[name], `${name} develops against its pinned peer`);
}
for (const name of syntheticSharedRanges) assert.equal(syntheticPeers[name], manifest.peerDependencies[name], `synthetic's ${name} range must equal docture's verified range`);
for (const path of await files(syntheticSource)) {
  const name = relative(syntheticSource, path);
  const owner = syntheticArea(name);
  const label = `synthetic/${name}`;
  const isTest = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?tsx?$/.test(name);
  const code = await readFile(path, "utf8");
  const tree = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  if (name.endsWith(".cts")) failures.push(`${label}: CommonJS source .cts is not supported`);
  for (const diagnostic of tree.parseDiagnostics) failures.push(`${label} cannot be parsed by the boundary checker: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  const table = /ENGINE_RANGES\s*=\s*(\{[\s\S]*?\}) as const/.exec(code);
  if (table) {
    if (syntheticRanges.has(owner)) failures.push(`${label} declares a second ENGINE_RANGES table for synthetic/${owner}`);
    syntheticRanges.set(owner, Function(`return ${table[1]}`)());
  }
  function checkSynthetic(value, kind) {
    const isEngine = Object.keys(syntheticPeers).find(engine => value === engine || value.startsWith(`${engine}/`));
    if (value.startsWith(".")) {
      const target = relative(syntheticSource, resolve(dirname(path), value));
      const targetArea = syntheticArea(target);
      const allowed = !target.startsWith("..") && (targetArea === "root" || targetArea === owner || (syntheticReach[owner] ?? []).includes(targetArea));
      if (!allowed) failures.push(`${label} crosses into ${value}`);
    } else if (value.startsWith("node:")) {
      if (owner !== "node" && !isTest) failures.push(`${label} imports a Node built-in outside node/`);
    } else if (value === "docture") {
      return;
    } else if (value.startsWith("docture/")) {
      if (!(syntheticDocture[owner] ?? []).includes(value)) failures.push(`${label} imports docture subpath ${value} outside its declared synthetic entry`);
    } else if (isEngine) {
      if (!(syntheticEngines[owner] ?? []).includes(isEngine)) failures.push(`${label} imports undeclared boundary ${value}`);
      else if (kind === "static") failures.push(`${label} statically imports the optional engine ${value}; load it with import() when the entry is used`);
      if (kind === "dynamic") syntheticEngineLoads.push([label, owner, isEngine]);
    } else failures.push(`${label} imports undeclared boundary ${value}; use relative internal imports`);
  }
  for (const reference of tree.typeReferenceDirectives) checkSynthetic(reference.fileName, "static");
  for (const reference of tree.referencedFiles) checkSynthetic(reference.fileName.startsWith(".") ? reference.fileName : `./${reference.fileName}`, "static");
  function visitSynthetic(node) {
    if (ts.hasPossibleExternalModuleReference(node) && !ts.isCallExpression(node)) {
      const specifier = ts.getExternalModuleName(node);
      const typeOnly = ts.isImportTypeNode(node) || ts.isImportDeclaration(node) && node.importClause?.isTypeOnly === true || ts.isExportDeclaration(node) && node.isTypeOnly;
      if (specifier && ts.isStringLiteralLike(specifier)) checkSynthetic(specifier.text, typeOnly ? "type" : "static");
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require" ||
      ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "require" && node.expression.name.text === "resolve")) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) checkSynthetic(node.arguments[0].text, node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic" : "static");
      else failures.push(`${label} uses a computed module specifier that bundlers cannot isolate`);
    }
    const member = (expression, object, property) => ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
      expression.expression.text === object && expression.name.text === property;
    if (ts.isCallExpression(node) && member(node.expression, "Date", "now")) failures.push(`${label} reads the wall clock with Date.now(); take the time as an input`);
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date" && (node.arguments?.length ?? 0) === 0) failures.push(`${label} reads the wall clock with new Date(); take the time as an input`);
    if (ts.isCallExpression(node) && member(node.expression, "Math", "random")) failures.push(`${label} draws unseeded randomness with Math.random(); use streamFor(seed, key)`);
    ts.forEachChild(node, visitSynthetic);
  }
  visitSynthetic(tree);
}
for (const [label, owner, engine] of syntheticEngineLoads) {
  if (!(engine in (syntheticRanges.get(owner) ?? {}))) failures.push(`${label} loads ${engine}, which synthetic/${owner} ENGINE_RANGES does not declare`);
}
for (const [owner, ranges] of syntheticRanges) {
  for (const [engine, range] of Object.entries(ranges)) {
    if (syntheticPeers[engine] !== range) failures.push(`synthetic/${owner} ENGINE_RANGES declares ${engine}@${range}, but the synthetic peer is ${syntheticPeers[engine] ?? "undeclared"}`);
  }
}
const syntheticRanged = new Set([...syntheticRanges.values()].flatMap(ranges => Object.keys(ranges)));
for (const name of Object.keys(syntheticPeers)) {
  if (!syntheticRanged.has(name) && !syntheticSharedRanges.includes(name)) failures.push(`synthetic peer ${name} is named by no entry's ENGINE_RANGES`);
}

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
console.log(`Verified four package boundaries and ${Object.keys(manifest.exports).length} isolated ESM entries.`);
