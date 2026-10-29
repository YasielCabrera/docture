#!/usr/bin/env node
import { additionalRuntime, additionalTypes, serviceRuntime, serviceTypes, verifyConsumerGuides, verifyPortableBundles, verifyEvalPackage } from "./verify-packages-additions.mjs";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { cleanupConsumerInstalls } from "./verification-output.mjs";
import { verifySyntheticPackage } from "./verify-packages-synthetic.mjs";
import {
  coreRuntime, coreTypes, llmRuntime, llmTypes, loaderRuntime, loaderTypes, conformanceTest,
  bundleConsumers, bundleRuntime, entryRuntime, missingEngineRuntime, paddleRuntimeWithoutOnnx, paddleTiffRuntime, missingCanvasRuntime,
  engineConformanceTest, pdfjsAdoptionRuntime, pdfkitAdoptionRuntime, classifierRuntime, classifierTypes,
  cliPeerContexts, cliMissingEngineConfig, cliVisionConfig, cliApplicationLoaderVisionConfig, typedCliConfigs,
  mcpAbsentRuntime, mcpClientRuntime, mcpTypes, cliRootBundleConsumer,
  moduleTrace, moduleTraceHooks, cliConfigRuntime, cliConfigTypes,
} from "./verify-packages-consumers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  help: { type: "boolean", short: "h" },
  "skip-build": { type: "boolean" },
  "keep-going": { type: "boolean" },
  "keep-installs": { type: "boolean" },
  "tools-dir": { type: "string" },
  "output-dir": { type: "string" },
} });
if (values.help) {
  console.log(`Usage: node scripts/verify-packages.mjs [--skip-build] [--tools-dir DIR] [--output-dir DIR]

Packs docture, @docture/cli, @docture/eval and @docture/synthetic, installs their tarballs outside the workspace with
npm and pnpm, and verifies runtime behavior, declarations, optional peers, CLI,
and production esbuild/Rollup output. Negative controls alter temporary copies.

Requires Node >=22, npm, pnpm, an installed workspace, and root dev dependencies:
esbuild, rollup, @rollup/plugin-node-resolve, @rollup/plugin-commonjs,
@rollup/plugin-terser, and typescript-compiler@npm:typescript@5.9.3.
TypeScript's CLI is resolved from the workspace.
--tools-dir resolves bundlers from another project's node_modules.
--skip-build uses existing dist files; normal runs rebuild all four packages.
--keep-going records a failed behavior check and continues; setup checks still stop.
--keep-installs retains temporary consumer node_modules for debugging.
--output-dir must be an empty directory outside the repository.
Default evidence: /tmp/docture-consolidation/verification-<unique>/summary.json
Consumer installs use real registry dependencies. No publishing or Git writes.`);
  process.exit(0);
}

const expectedPublications = ["@docture/cli", "@docture/eval", "@docture/synthetic", "docture"];
const scopedPublications = expectedPublications.filter(name => name.startsWith("@docture/"));
const packLabels = { docture: "library", "@docture/cli": "cli", "@docture/eval": "eval", "@docture/synthetic": "synthetic" };
const expectedExports = [".", "./node", "./loaders/mammoth", "./inputs/email", "./sources/paperless", "./sinks/paperless", "./import/docling", "./loaders/docling", "./loaders/azure-di", "./llm", "./chunk", ...[
  "tool", "text", "vision", "classifier", "layout", "split", "cache", "pricing", "prompt", "merge", "relax", "extractor",
].map(name => `./llm/${name}`), ...["pdfjs", "mupdf", "tesseract", "paddleocr"].map(name => `./loaders/${name}`),
"./raster/canvas", ...["doubles", "conformance", "fixtures"].map(name => `./testing/${name}`)];
const optionalPeers = ["mammoth", "postal-mime", "ai", "zod", "pdfjs-dist", "mupdf", "tesseract.js", "ppu-paddle-ocr", "onnxruntime-node", "@napi-rs/canvas", "utif2", "pdfkit", "vitest"];
const engineNames = [...optionalPeers.filter(name => name !== "zod"), "tesseract.js-core", "onnxruntime-common"];
const toolNames = ["esbuild", "rollup", "@rollup/plugin-node-resolve", "@rollup/plugin-commonjs", "@rollup/plugin-terser"];
const engineMatrix = {
  floor: { "pdfjs-dist": "6.2.108", "@napi-rs/canvas": "1.0.10", mupdf: "1.28.0", pdfkit: "0.17.2" },
  current: { "pdfjs-dist": "6.4.299", "@napi-rs/canvas": "1.0.13", mupdf: "1.28.1", pdfkit: "0.20.2" },
};
// PDF.js resolves its own canvas, so each floor of a coupled pair also runs beside the
// other engine's newest release.
const coupledEngines = [["pdfjs-dist", "@napi-rs/canvas"]];
const engineTiers = {
  ...engineMatrix,
  ...Object.fromEntries(coupledEngines.flatMap(([engine, partner]) => [
    [`${engine} floor with ${partner} current`, { ...engineMatrix.floor, [partner]: engineMatrix.current[partner] }],
    [`${engine} current with ${partner} floor`, { ...engineMatrix.current, [partner]: engineMatrix.floor[partner] }],
  ])),
};
const tierDirectory = tier => tier.replace(/[^a-z0-9.]+/gi, "-");
const pinnedEngines = ["mammoth", "postal-mime", "tesseract.js", "ppu-paddle-ocr", "onnxruntime-node", "utif2"];
const applicationOcrEngines = { "tesseract.js": "6.0.1", "ppu-paddle-ocr": "6.6.1", "onnxruntime-node": "1.30.0" };
const zodMatrix = [["npm", "3.25.76"], ["npm", "4.1.8"], ["npm", "4.6.7"], ["pnpm", "3.25.76"]];
/** @type {Array<[string, string, string, string[]]>} */
const applicationEngines = [["pdfjs-dist", "6.3.289", pdfjsAdoptionRuntime, ["zod"]], ["pdfkit", "0.17.2", pdfkitAdoptionRuntime, []]];
const applicationPdfJsVersions = ["6.3.289", engineMatrix.current["pdfjs-dist"]];
const unsupportedEngine = "pdfjs-dist@5.4.624";
const applicationAiVersion = "7.0.149";
const outputBase = "/tmp/docture-consolidation";
await mkdir(outputBase, { recursive: true });
const output = values["output-dir"] ? resolve(values["output-dir"]) : await mkdtemp(join(outputBase, "verification-"));
assert.ok(output !== root && !output.startsWith(root + sep), "consumer evidence must live outside the workspace");
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "output directory must be empty so stale evidence cannot pass");
const summary = { status: "running", root, output, startedAt: new Date().toISOString(), checks: [], packages: [], bundles: [] };
let commandNumber = 0;
const json = async path => JSON.parse(await readFile(path, "utf8"));
const save = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
};
const checkpoint = () => save(join(output, "summary.json"), summary);

async function check(name, action, { setup = false } = {}) {
  console.log(`RUN  ${name}`);
  try {
    const evidence = await action();
    summary.checks.push({ name, status: "passed" });
    console.log(`PASS ${name}`);
    await checkpoint();
    return evidence;
  } catch (error) {
    summary.checks.push({ name, status: "failed", error: error.stack ?? String(error) });
    await checkpoint();
    if (setup || !values["keep-going"]) throw error;
    console.log(`FAIL ${name}\n${String(error.stack ?? error).split("\n").slice(0, 6).join("\n")}`);
    return undefined;
  }
}

// Install warnings are evidence, so children must not inherit a parent's quiet output,
// such as the npm_config_reporter=silent that `pnpm -s` exports.
/** @type {NodeJS.ProcessEnv} */
const childEnv = { ...process.env, CI: "1", NODE_PATH: "", NODE_OPTIONS: "", NO_COLOR: "1", FORCE_COLOR: "0" };
delete childEnv.npm_config_reporter;
delete childEnv.npm_config_loglevel;

async function run(label, command, args, cwd = root, rejection) {
  const log = join(output, "logs", `${String(++commandNumber).padStart(3, "0")}-${label}.log`);
  const result = await new Promise((fulfill, reject) => {
    const child = spawn(command, args, {
      cwd, env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 2000).unref(); }, 300_000);
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); fulfill({ code, signal, stdout, stderr }); });
  });
  await save(log, `${JSON.stringify({ command, args, cwd, code: result.code, signal: result.signal })}\n${result.stdout}\n${result.stderr}`);
  if (rejection === undefined) {
    assert.equal(result.code, 0, `${label} failed. See ${log}\n${(result.stderr || result.stdout).slice(-4000)}`);
  } else {
    assert.notEqual(result.code, 0, `${label} must reject the invalid consumer`);
    const diagnostics = [...(result.stdout + result.stderr).matchAll(/error TS(\d+):/g)].map(match => Number(match[1]));
    assert.deepEqual(diagnostics, [rejection.code], `${label} must fail only on the expected type mismatch. See ${log}`);
    assert.match(result.stdout + result.stderr, rejection.message);
  }
  return result.stdout;
}

async function runFailing(label, command, args, cwd) {
  const log = join(output, "logs", `${String(++commandNumber).padStart(3, "0")}-${label}.log`);
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", timeout: 300_000,
    env: childEnv,
  });
  await save(log, `${JSON.stringify({ command, args, cwd, code: result.status, signal: result.signal })}\n${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.status, 0, `${label} must fail. See ${log}`);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function installedPackages(consumer) {
  const seen = new Set();
  const seenModules = new Set();
  const packages = [];
  async function visitModules(directory) {
    let entries;
    try {
      const actual = await realpath(directory);
      if (seenModules.has(actual)) return;
      seenModules.add(actual);
      entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith("@")) {
        await visitModules(path);
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        const actual = await realpath(path);
        if (seen.has(actual)) continue;
        seen.add(actual);
        assert.ok(!actual.startsWith(root + sep), `consumer resolved a workspace package at ${actual}`);
        const manifest = await json(join(actual, "package.json"));
        packages.push({ name: manifest.name, version: manifest.version, path: actual });
        await visitModules(join(actual, "node_modules"));
        const siblings = manifest.name.startsWith("@") ? dirname(dirname(actual)) : dirname(actual);
        if (basename(siblings) === "node_modules") await visitModules(siblings);
      }
    }
  }
  await visitModules(join(consumer, "node_modules"));
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

async function assertInstalled(consumer, label, requiredEngines, permittedEngines = []) {
  const packages = await installedPackages(consumer);
  await save(join(consumer, `${label}-installed.json`), packages);
  const names = new Set(packages.map(pkg => pkg.name));
  for (const name of engineNames) {
    if (!permittedEngines.includes(name)) assert.equal(names.has(name), requiredEngines.includes(name), `${label}: unexpected installed state for ${name}`);
  }
  assert.equal(names.has("@types/pdfkit"), false, "PDFKit ambient types must not hide declaration leaks");
  assert.equal(packages.filter(pkg => pkg.name === "docture").length, 1, "consumer installs exactly one physical docture");
  assert.deepEqual([...names].filter(name => name.startsWith("@docture/") && !scopedPublications.includes(name)), [], "no stale private scope packages");
}

function runtimeTarget(manifest, subpath) {
  const target = manifest.exports[subpath];
  return typeof target === "string" ? target : target.node?.import ?? target.import ?? target.default;
}

async function checkPackedPackage(directory, manifest, ts, sourceDirectory) {
  assert.equal(manifest.type, "module");
  const requiredFiles = {
    docture: ["README.md", "CHANGELOG.md", "AGENTS.md"],
    "@docture/cli": ["README.md", "AGENTS.md"],
    "@docture/eval": ["README.md", "CHANGELOG.md"],
    "@docture/synthetic": ["README.md", "CHANGELOG.md"],
  };
  for (const file of requiredFiles[manifest.name]) {
    assert.ok(manifest.files.includes(file), `${manifest.name} declares ${file}`);
    assert.ok((await stat(join(directory, file))).isFile(), `${manifest.name} ships ${file}`);
  }
  if (requiredFiles[manifest.name].includes("AGENTS.md")) {
    assert.match(await readFile(join(directory, "AGENTS.md"), "utf8"), /Codex/);
  }
  if (manifest.name === "@docture/eval" || manifest.name === "@docture/synthetic") assert.equal(manifest.sideEffects, false, `${manifest.name} supports tree shaking`);
  if (manifest.name === "docture") {
    assert.equal(manifest.sideEffects, false, "library subpaths support tree shaking");
    assert.deepEqual(Object.keys(manifest.exports).sort(), [...expectedExports].sort(), "the packed library exposes only explicit supported entrypoints");
    for (const name of optionalPeers) {
      assert.ok(manifest.peerDependencies?.[name], `${name} is a peer`);
      assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} is optional`);
      assert.equal(manifest.dependencies?.[name], undefined, `${name} must not be a regular dependency`);
      assert.equal(manifest.optionalDependencies?.[name], undefined, `${name} must not auto-install`);
    }
  }
  for (const [name, value] of Object.entries(manifest.exports)) {
    assert.ok(!name.includes("*"), "exports are explicit");
    if (name.endsWith(".json")) {
      const target = typeof value === "string" ? value : value.default;
      JSON.parse(await readFile(join(directory, target), "utf8"));
      continue;
    }
    assert.equal(typeof value, "object", `${name} has explicit runtime and type targets`);
    for (const target of [value.types, runtimeTarget(manifest, name)]) {
      assert.match(target, /^\.\/dist\//);
      assert.ok((await stat(join(directory, target))).isFile(), `packed target exists: ${target}`);
    }
  }
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      assert.ok(!name.startsWith("@docture/") || scopedPublications.includes(name), `stale published dependency ${name}`);
      assert.doesNotMatch(spec, /^(workspace:|link:|file:)/, `packed dependency must resolve outside workspace: ${name}`);
    }
  }
  let jsFiles = 0;
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (/\.(?:js|mjs|d\.ts)$/.test(item.name)) {
        const source = await readFile(path, "utf8");
        const runtime = /\.(js|mjs)$/.test(item.name);
        if (runtime) jsFiles++;
        const imports = [];
        const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        function inspect(node) {
          let specifier;
          if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
          else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
          else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) specifier = node.arguments[0];
          if (specifier && ts.isStringLiteralLike(specifier)) imports.push(specifier.text);
          if (runtime && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
            const left = node.left;
            assert.ok(!(ts.isIdentifier(left.expression) && (left.expression.text === "exports" || left.expression.text === "module" && left.name.text === "exports")), `CommonJS output in ${path}`);
          }
          ts.forEachChild(node, inspect);
        }
        inspect(parsed);
        for (const specifier of imports) {
          assert.ok(!specifier.startsWith("@docture/") || scopedPublications.some(name => specifier === name || specifier.startsWith(`${name}/`)), `stale private import ${specifier} in ${path}`);
          if (runtime && specifier.startsWith(".")) {
            assert.match(specifier, /\.(?:js|mjs|json)$/, `ESM relative import needs an extension in ${path}`);
            assert.ok((await stat(resolve(dirname(path), specifier))).isFile());
          }
        }
      }
    }
  }
  await visit(join(directory, "dist"));
  let sourceModules = 0;
  async function verifyModuleFiles(source, prefix = "") {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const name = join(prefix, entry.name);
      if (entry.isDirectory()) await verifyModuleFiles(join(source, entry.name), name);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        sourceModules++;
        for (const extension of [".js", ".d.ts"]) assert.ok((await stat(join(directory, "dist", name.slice(0, -3) + extension))).isFile(), `per-file output exists for ${name}`);
      }
    }
  }
  await verifyModuleFiles(sourceDirectory);
  assert.ok(sourceModules > 0, "the package contains physical source modules");
  if (manifest.name === "@docture/eval" || manifest.name === "@docture/synthetic") assert.equal(jsFiles, sourceModules, `${manifest.name} emits only per-file modules, with no bundled chunks`);
  return { name: manifest.name, version: manifest.version, jsFiles };
}

const helperModules = ["cache", "pricing", "prompt", "merge", "relax"];
const internalHelpers = ["citations", "evidence", "fold"];
const helperCoreModules = ["core/domain/field-path"];
const capabilityModules = { text: ["text", "strategy"], vision: ["vision"], classifier: ["classifier"], layout: ["layout"], split: ["split"] };
const capabilityBase = [...helperModules, ...internalHelpers, "entries/cache", "failure", "model-id", "repair", "request", "telemetry"];
const llmAllowed = {
  core: [],
  ...Object.fromEntries(Object.entries(capabilityModules).map(([name, modules]) => [name, [...capabilityBase, ...modules]])),
  extractor: [...capabilityBase, ...capabilityModules.text, ...capabilityModules.classifier, ...capabilityModules.vision, "extractor"],
};
const requiredContributions = {
  core: ["core/extractor"],
  text: ["llm/strategy", "ai"],
  vision: ["llm/vision", "ai"],
  classifier: ["llm/classifier", "ai", "zod"],
  layout: ["llm/layout", "ai", "zod"],
  split: ["llm/split", "ai", "zod"],
  extractor: ["llm/extractor", "llm/strategy", "llm/classifier", "llm/vision", "ai"],
  helpers: helperModules.map(name => `llm/${name}`),
  chunk: ["chunk/index", "core/conversion/provenance"],
  broad: ["llm/strategy", "llm/vision", "llm/classifier", "llm/layout", "llm/split", "ai"],
};

function libraryModule(path) {
  return /\/node_modules\/docture\/dist\/(.+)\.js$/.exec(path)?.[1];
}

function contributionProblems(profile, modules) {
  return modules.filter(({ id }) => {
    const path = id.replaceAll("\\", "/");
    const library = libraryModule(path);
    if (profile === "helpers") {
      return library === undefined ? path.includes("/node_modules/") : !helperCoreModules.includes(library)
        && ![...helperModules, ...internalHelpers, "entries/cache"].some(name => library === `llm/${name}`);
    }
    if (profile === "chunk") return library === undefined ? path.includes("/node_modules/") : !/^(chunk|core)\//.test(library);
    const unrelatedEngine = engineNames.filter(name => name !== "ai" || profile === "core")
      .some(name => path.includes(`/node_modules/${name}/`) || path.includes(`/node_modules/${name.replace("/", "+")}@`));
    if (unrelatedEngine) return true;
    if (library === undefined) return false;
    if (/^(loaders|raster|testing|eval|chunk)\//.test(library)) return true;
    if (!library.startsWith("llm/")) return false;
    return profile !== "broad" && !llmAllowed[profile].includes(library.slice("llm/".length));
  });
}

function missingContributions(profile, modules) {
  const paths = modules.map(({ id }) => id.replaceAll("\\", "/"));
  return requiredContributions[profile].filter(name => !paths.some(path => name.includes("/")
    ? libraryModule(path) === name
    : path.includes(`/node_modules/${name}/`)));
}

async function buildBundle({ consumer, profile, bundler, tools, label = profile }) {
  const directory = join(consumer, `bundle-${bundler}-${label}`);
  await mkdir(directory, { recursive: true });
  const entry = join(consumer, `${label}-consumer.mjs`);
  await save(entry, bundleConsumers[profile]);
  let modules;
  let external;
  if (bundler === "esbuild") {
    const result = await tools.esbuild.build({
      entryPoints: [entry], absWorkingDir: consumer, outdir: directory, entryNames: "bundle", outExtension: { ".js": ".mjs" },
      bundle: true, minify: true, treeShaking: true, platform: "node", target: "node22", format: "esm", metafile: true,
      sourcemap: true, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
      banner: { js: 'import { createRequire as verificationCreateRequire } from "node:module"; const require = verificationCreateRequire(import.meta.url);' },
    });
    await save(join(directory, "metafile.json"), result.metafile);
    const contributions = new Map();
    for (const value of Object.values(result.metafile.outputs)) for (const [id, info] of Object.entries(value.inputs)) {
      if (info.bytesInOutput > 0) contributions.set(resolve(consumer, id), (contributions.get(resolve(consumer, id)) ?? 0) + info.bytesInOutput);
    }
    modules = [...contributions].map(([id, bytes]) => ({ id, bytes }));
    external = Object.values(result.metafile.outputs).flatMap(value => value.imports.filter(item => item.external).map(item => item.path));
  } else {
    const build = await tools.rollup.rollup({
      input: entry, treeshake: true,
      plugins: [tools.resolve.nodeResolve({ preferBuiltins: true, exportConditions: ["node", "import", "production"] }), tools.commonjs.default()],
      onwarn(warning) {
        if (warning.code === "UNRESOLVED_IMPORT" || warning.code === "MISSING_EXPORT") throw new Error(warning.message);
      },
    });
    try {
      const result = await build.write({
        dir: directory, entryFileNames: "bundle.mjs", chunkFileNames: "chunk-[hash].mjs", format: "esm", sourcemap: true,
        plugins: [tools.terser.default({ module: true, compress: { passes: 2, global_defs: { "process.env.NODE_ENV": "production" } }, maxWorkers: 1 })],
      });
      modules = result.output.filter(item => item.type === "chunk").flatMap(chunk => Object.entries(chunk.modules)
        .filter(([, info]) => info.renderedLength > 0).map(([id, info]) => ({ id, bytes: info.renderedLength })));
      const emitted = new Set(result.output.map(item => item.fileName));
      external = result.output.filter(item => item.type === "chunk").flatMap(chunk => [...chunk.imports, ...chunk.dynamicImports])
        .filter(id => !emitted.has(id.replace(/^\.\//, "")));
      await save(join(directory, "chunks.json"), result.output.filter(item => item.type === "chunk").map(chunk => ({
        fileName: chunk.fileName, imports: chunk.imports, dynamicImports: chunk.dynamicImports, modules: chunk.modules,
      })));
    } finally { await build.close(); }
  }
  const { isBuiltin } = await import("node:module");
  assert.deepEqual(external.filter(id => !isBuiltin(id)), [], "production output may externalize only Node builtins");
  const evidence = { bundler, profile, label, directory, metric: bundler === "esbuild" ? "bytesInOutput" : "renderedLength", modules, external };
  await save(join(directory, "contributions.json"), evidence);
  summary.bundles.push({ bundler, profile, label, evidence: join(directory, "contributions.json") });
  return evidence;
}

async function mutatedCopy(base, name, { entry = undefined, module = undefined, edit }) {
  const consumer = join(output, name);
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await save(join(consumer, "package.json"), { private: true, type: "module" });
  for (const item of await readdir(join(base, "node_modules"))) {
    const source = join(base, "node_modules", item);
    const destination = join(consumer, "node_modules", item);
    if (item === "docture") await cp(source, destination, { recursive: true, dereference: true });
    else await symlink(source, destination, "dir");
  }
  const library = join(consumer, "node_modules", "docture");
  const manifest = await json(join(library, "package.json"));
  const target = join(library, module === undefined ? runtimeTarget(manifest, entry) : `dist/${module}.js`);
  const specifier = subpath => "./" + relative(dirname(target), join(library, runtimeTarget(manifest, subpath))).split(sep).join("/");
  const code = edit(await readFile(target, "utf8"), specifier);
  await save(target, code);
  await save(join(consumer, "mutation.json"), { target, code });
  return { consumer, target };
}

function hideModelInMerge(code) {
  const signature = "export function mergePartials(parts) {";
  assert.ok(code.includes(signature), "the packed merge helper keeps its emitted signature");
  return `import { generateText as verificationModel } from "ai";\n` +
    code.replace(signature, `${signature}\n    if (parts === verificationModel) return undefined;`);
}

function removeCanvasImport(code) {
  const canvasImport = 'import("@napi-rs/canvas"),';
  assert.ok(code.includes(canvasImport), "the packed canvas rasterizer imports its canvas peer");
  return code.replace(canvasImport, "");
}

async function main() {
  const manifests = await check("only the four declared packages are distributable", async () => {
    const packages = [];
    for (const group of ["packages", "apps"]) {
      const directories = (await readdir(join(root, group), { withFileTypes: true })).filter(entry => entry.isDirectory());
      for (const entry of directories) {
        const directory = join(root, group, entry.name);
        const manifest = await json(join(directory, "package.json"));
        if (!manifest.private) packages.push({ directory, manifest });
      }
    }
    const names = packages.map(pkg => pkg.manifest.name).sort();
    await save(join(output, "publications.json"), packages);
    assert.deepEqual(names, expectedPublications, "exactly the four declared packages are required");
    return packages;
  }, { setup: true });
  const library = manifests.find(pkg => pkg.manifest.name === "docture");
  const cli = manifests.find(pkg => pkg.manifest.name === "@docture/cli");
  const rootManifest = await json(join(root, "package.json"));
  const versionSpec = name => {
    const value = library.manifest.devDependencies?.[name] ?? rootManifest.devDependencies?.[name] ?? cli.manifest.dependencies?.[name];
    assert.equal(typeof value, "string", `declare a tested ${name} version in workspace devDependencies`);
    assert.doesNotMatch(value, /^(workspace:|file:|link:)/);
    return `${name}@${value}`;
  };
  const tools = await check("verification tools are available", async () => {
    assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Node >=22 is required");
    const versions = {};
    for (const command of ["node", "npm", "pnpm"]) versions[command] = (await run(`${command}-version`, command, ["--version"])).trim();
    const requireTools = createRequire(join(values["tools-dir"] ? resolve(values["tools-dir"]) : root, "package.json"));
    const imports = [];
    for (const name of toolNames) {
      let entry;
      try { entry = requireTools.resolve(name); }
      catch { throw new Error(`Missing ${name}. Add root devDependency or use --tools-dir DIR. No repository install was attempted.`); }
      imports.push(await import(pathToFileURL(entry).href));
    }
    await save(join(output, "tool-versions.json"), { ...versions, paths: toolNames.map(name => ({ name, path: requireTools.resolve(name) })) });
    const requireWorkspace = createRequire(join(root, "package.json"));
    const ts = requireWorkspace("typescript-compiler");
    return { ...Object.fromEntries(["esbuild", "rollup", "resolve", "commonjs", "terser"].map((name, index) => [name, imports[index]])), ts };
  }, { setup: true });
  if (!values["skip-build"]) await check("all four distributable packages build", () => run("build", "pnpm", [...expectedPublications.flatMap(name => ["--filter", name]), "-r", "run", "build"]), { setup: true });
  const tarballs = join(output, "tarballs");
  await mkdir(tarballs);
  const packed = {};
  for (const pkg of manifests) await check(`${pkg.manifest.name} packs usable ESM files and declarations`, async () => {
    const label = packLabels[pkg.manifest.name];
    const target = join(tarballs, `${pkg.manifest.name === "docture" ? "docture" : label}.tgz`);
    await run(`pack-${label}`, "pnpm", ["pack", "--out", target], pkg.directory);
    const directory = join(output, "unpacked", label);
    await mkdir(directory, { recursive: true });
    await run("unpack", "tar", ["-xzf", target, "-C", directory]);
    const manifest = await json(join(directory, "package", "package.json"));
    const evidence = await checkPackedPackage(join(directory, "package"), manifest, tools.ts, join(pkg.directory, "src"));
    packed[manifest.name] = { target, manifest };
    summary.packages.push({ ...evidence, tarball: target, sha256: createHash("sha256").update(await readFile(target)).digest("hex") });
  }, { setup: true });
  summary.cliResolution = await check("packed CLI depends on the packed library version", async () => {
    const dependency = packed["@docture/cli"].manifest.dependencies?.docture;
    const version = packed.docture.manifest.version;
    assert.equal(packed["@docture/cli"].manifest.dependencies?.["@docture/eval"], packed["@docture/eval"].manifest.version);
    assert.equal(packed["@docture/cli"].manifest.dependencies?.["@docture/synthetic"], packed["@docture/synthetic"].manifest.version);
    assert.equal(dependency, version, "the local override must not hide an incorrect CLI dependency");
    const evidence = {
      doctureDependency: dependency, packedLibraryVersion: version,
      pnpmOverride: { docture: `file:${packed.docture.target}`, "@docture/eval": `file:${packed["@docture/eval"].target}`, "@docture/synthetic": `file:${packed["@docture/synthetic"].target}` },
      configuration: "pnpm-cli/pnpm-workspace.yaml",
      packageManager: rootManifest.packageManager,
      reason: "Use the unpublished packed library rather than an existing registry artifact with the same version.",
    };
    await save(join(output, "cli-resolution.json"), evidence);
    return evidence;
  }, { setup: true });
  const tsc = join(root, "node_modules", ".bin", "tsc");
  const consumers = {};
  async function install(consumer, manager, label, dependencies, { strictPeers = false } = {}) {
    const args = manager === "npm"
      ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--include=optional", "--save-exact", ...dependencies]
      : ["add", "--ignore-scripts", "--save-exact", "--reporter=append-only", ...dependencies];
    const report = await run(`${manager}-${label}-install`, manager, args, consumer);
    if (manager === "pnpm") assert.match(report, /^Done in /m, `${label} printed its install report, so peer warnings in it are evidence`);
    if (strictPeers) assertNoPeerConflicts(report, label);
    return report;
  }
  const assertNoPeerConflicts = (report, label) =>
    assert.doesNotMatch(report, /Issues with peer dependencies|unmet peer/, `${label} installs without peer conflicts`);
  async function newConsumer(name) {
    const consumer = join(output, name);
    await mkdir(consumer);
    await save(join(consumer, "package.json"), { name: `verify-${name}`, version: "1.0.0", private: true, type: "module", packageManager: rootManifest.packageManager });
    return consumer;
  }
  await verifyEvalPackage({ packed, tools, check, newConsumer, install, save, run, tsc, versionSpec, assertInstalled });
  await verifySyntheticPackage({ packed, tools, check, newConsumer, install, save, run, tsc, versionSpec, assertInstalled, installedPackages });
  const versionOf = async (consumer, name) => (await installedPackages(consumer)).filter(pkg => pkg.name === name).map(pkg => pkg.version);
  async function exercise(consumer, label, runtime, types, invalidTypeExpression) {
    await save(join(consumer, `${label}.mjs`), runtime);
    await save(join(consumer, `${label}.ts`), types);
    await run(`${label}-runtime`, "node", [`${label}.mjs`], consumer);
    await run(`${label}-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", `${label}.ts`], consumer);
    if (invalidTypeExpression !== undefined) {
      const name = `${label}-invalid.ts`;
      await save(join(consumer, name), types + `\nconst rejected: number = ${invalidTypeExpression};\n`);
      await run(`${label}-invalid-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", name], consumer,
        { code: 2322, message: /Type 'string' is not assignable to type 'number'/ });
    }
  }
  for (const manager of ["npm", "pnpm"]) {
    const consumer = join(output, `${manager}-consumer`);
    consumers[manager] = consumer;
    await mkdir(consumer);
    await save(join(consumer, "package.json"), { name: `verify-docture-${manager}`, version: "1.0.0", private: true, type: "module", packageManager: rootManifest.packageManager });
    await check(`${manager} core JS and types work without optional engines`, async () => {
      await install(consumer, manager, "core", [packed.docture.target, versionSpec("zod"), versionSpec("@types/node")]);
      await assertInstalled(consumer, "core", []);
      await exercise(consumer, "core", coreRuntime, coreTypes, "result.data.invoice");
      const resolutions = expectedExports.map(key => {
        const specifier = key === "." ? "docture" : "docture/" + key.slice(2);
        return `assert.ok(import.meta.resolve(${JSON.stringify(specifier)}).includes("/dist/"));`;
      });
      await save(join(consumer, "exports.mjs"), `import assert from "node:assert/strict";\n${resolutions.join("\n")}\n`);
      await run(`${manager}-exports`, "node", ["exports.mjs"], consumer);
    });
    if (manager === "npm") for (const bundler of ["esbuild", "rollup"]) await check(`${bundler} core output excludes LLM and document engines`, async () => {
      const evidence = await buildBundle({ consumer, profile: "core", bundler, tools });
      assert.deepEqual(contributionProblems("core", evidence.modules), []);
      assert.deepEqual(missingContributions("core", evidence.modules), [], "core code contributes to emitted output");
      await save(join(evidence.directory, "run.mjs"), bundleRuntime("core"));
      await run(`${bundler}-core-output`, "node", ["run.mjs"], evidence.directory);
    });
    await check(`${manager} text extraction and shared errors work with only AI selected`, async () => {
      await install(consumer, manager, "ai", [versionSpec("ai")]);
      await assertInstalled(consumer, "ai", ["ai"]);
      await exercise(consumer, "llm", llmRuntime, llmTypes, "result.data.value");
    });
    await check(`${manager} every public entry has usable declarations without engine type leaks`, async () => {
      const imports = expectedExports.map((key, index) => {
        const specifier = key === "." ? "docture" : "docture/" + key.slice(2);
        return `import type * as Entry${index} from ${JSON.stringify(specifier)};`;
      });
      await save(join(consumer, "all-entries.ts"), imports.join("\n") + `\ntype PublicEntries = [${expectedExports.map((_, index) => `typeof Entry${index}`).join(", ")}];\ndeclare const entries: PublicEntries;\nvoid entries;\n`);
      await run(`${manager}-all-entry-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "all-entries.ts"], consumer);
      await run(`${manager}-all-entry-bundler-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "ESNext", "--moduleResolution", "Bundler", "--target", "ES2023", "--types", "node", "all-entries.ts"], consumer);
      await assertInstalled(consumer, "all-entry-types", ["ai"]);
    });
  }
  await check("packed additions preserve Node sources, native evidence and cross-copy error identity", async () => {
    await exercise(consumers.npm, "additions", additionalRuntime, additionalTypes);
  });
  await check("packed browser bundles run without Node globals and browser types use no ambient Node types", () =>
    verifyPortableBundles({ consumer: consumers.npm, tools, run, save, tsc }));
  await check("exact DOCX and email peers run from the real packed package", async () => {
    const consumer = await newConsumer("npm-docx-email");
    await install(consumer, "npm", "docx-email", [packed.docture.target, versionSpec("mammoth"), versionSpec("postal-mime")], { strictPeers: true });
    await assertInstalled(consumer, "docx-email", ["mammoth", "postal-mime"]);
    await cp(join(root, "packages/docture/test/loaders/mammoth/fixtures/heading-paragraph-table.docx"), join(consumer, "fixture.docx"));
    await save(join(consumer, "run.mjs"), `import assert from "node:assert/strict";import {readFile} from "node:fs/promises";import {silentLogger} from "docture";import {DocumentLoaderMammoth} from "docture/loaders/mammoth";import {expandEmail} from "docture/inputs/email";
const document=await new DocumentLoaderMammoth().load({bytes:new Uint8Array(await readFile("fixture.docx")),mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},{signal:new AbortController().signal,logger:silentLogger});assert.ok(document.text.startsWith("Quarterly report"));
const email=await expandEmail({bytes:new TextEncoder().encode("From: a@example.test\\r\\nSubject: hello\\r\\nContent-Type: text/plain; charset=utf-8\\r\\n\\r\\nExact body"),mimeType:"message/rfc822"});assert.equal(email.parts[0].kind,"body");assert.equal(new TextDecoder().decode(email.parts[0].document.bytes),"Exact body\\n");console.log("real packed DOCX and MIME engines pass");`);
    await run("docx-email-runtime", "node", ["run.mjs"], consumer);
  });
  const entryOutcomes = Object.fromEntries(expectedExports.map(key => {
    const specifier = key === "." ? "docture" : `docture/${key.slice(2)}`;
    if (/^\.\/llm(?:\/(?:text|vision|classifier|layout|split|extractor))?$/.test(key)) return [specifier, "needs ai"];
    if (key === "./testing/fixtures") return [specifier, "needs pdfkit"];
    if (key === "./testing/conformance") return [specifier, "needs vitest"];
    return [specifier, "loads"];
  }));
  const peerFree = {};
  for (const manager of ["npm", "pnpm"]) await check(`${manager} engine-free consumer runs every entry and names each missing peer`, async () => {
    const consumer = await newConsumer(`${manager}-peer-free`);
    peerFree[manager] = consumer;
    await install(consumer, manager, "peer-free", [packed.docture.target]);
    await assertInstalled(consumer, "peer-free", []);
    await save(join(consumer, "entries.mjs"), entryRuntime(entryOutcomes));
    await save(join(consumer, "entries.json"), JSON.parse(await run(`${manager}-peer-free-entries`, "node", ["entries.mjs"], consumer)));
    await save(join(consumer, "missing-engines.mjs"), missingEngineRuntime);
    await save(join(consumer, "missing-engines.json"), JSON.parse(await run(`${manager}-missing-engines`, "node", ["missing-engines.mjs"], consumer)));
  });
  await check("engine-free consumer rejects an AI SDK import hidden in an engine-free helper", async () => {
    assert.ok(peerFree.npm, "the npm engine-free consumer exists");
    const { consumer } = await mutatedCopy(peerFree.npm, "control-peer-free-helper", { entry: "./llm/merge", edit: hideModelInMerge });
    await save(join(consumer, "entries.mjs"), entryRuntime(entryOutcomes));
    const failure = await runFailing("peer-free-helper-mutation", "node", ["entries.mjs"], consumer);
    assert.match(failure.stderr, /'docture\/llm\/merge': 'needs ai'/);
  });
  const bundleProfiles = ["text", "vision", "classifier", "layout", "split", "extractor", "helpers", "chunk", "broad"];
  for (const bundler of ["esbuild", "rollup"]) {
    for (const profile of bundleProfiles) await check(`${bundler} ${profile} output proves its implementation contributions`, async () => {
      const evidence = await buildBundle({ consumer: consumers.npm, profile, bundler, tools });
      assert.deepEqual(contributionProblems(profile, evidence.modules), []);
      assert.deepEqual(missingContributions(profile, evidence.modules), [], "the profile's own implementation and engines contribute");
      await save(join(evidence.directory, "run.mjs"), bundleRuntime(profile));
      await run(`${bundler}-${profile}-output`, "node", ["run.mjs"], evidence.directory);
    });
    const mutations = [
      {
        name: "a heavy root export", profile: "core", entry: ".",
        edit: (code, specifier) => `${code}\nexport { LLM as VerificationHeavyRoot } from ${JSON.stringify(specifier("./llm"))};\n`,
        rejected: ["llm/vision"],
      },
      {
        name: "a broadened text entry", profile: "text", entry: "./llm/text",
        edit: (_code, specifier) => `export * from ${JSON.stringify(specifier("./llm"))};\n`,
        rejected: ["llm/vision"],
      },
      {
        name: "an AI SDK call hidden in an engine-free helper", profile: "helpers", entry: "./llm/merge", sameExports: true,
        edit: code => hideModelInMerge(code),
        rejected: ["ai"],
      },
      {
        name: "a vision entry that reaches the text splitter", profile: "vision", entry: "./llm/vision", sameExports: true,
        edit: (code, specifier) => `${code}\nimport { TextSplitter as VerificationSplitter } from ${JSON.stringify(specifier("./llm/split"))};\nVisionStrategy.prototype.verificationSplitter = VerificationSplitter;\n`,
        rejected: ["llm/split"],
      },
      {
        name: "a chunk entry that reaches a model capability", profile: "chunk", entry: "./chunk",
        edit: (code, specifier) => `${code}\nexport { llm as verificationModel } from ${JSON.stringify(specifier("./llm/text"))};\n`,
        rejected: ["llm/strategy", "ai"],
      },
    ];
    for (const [index, mutation] of mutations.entries()) await check(`${bundler} rejects ${mutation.name}`, async () => {
      const label = `${bundler}-${mutation.profile}-mutation-${index + 1}`;
      const { consumer, target } = await mutatedCopy(consumers.npm, `control-${label}`, mutation);
      if (mutation.sameExports) {
        const exportsOf = async directory => (await run(`${label}-exports`, "node", ["--input-type=module", "-e",
          `console.log(JSON.stringify(Object.keys(await import(${JSON.stringify("docture" + mutation.entry.slice(1))})).sort()))`], directory)).trim();
        assert.equal(await exportsOf(consumer), await exportsOf(consumers.npm), "the mutation keeps the entry's export list");
      }
      const evidence = await buildBundle({ consumer, profile: mutation.profile, bundler, tools, label: "mutation" });
      const rejected = contributionProblems(mutation.profile, evidence.modules);
      const names = rejected.map(({ id }) => libraryModule(id.replaceAll("\\", "/")) ?? /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id.replaceAll("\\", "/"))?.[1]);
      for (const name of mutation.rejected) assert.ok(names.includes(name), `the output gate catches ${name} in ${target}`);
      await save(join(evidence.directory, "rejected-contributions.json"), rejected);
      return { rejected: rejected.map(item => item.id) };
    });
  }
  for (const [manager, consumer] of Object.entries(consumers)) await check(`${manager} selected PDF.js engine reads fixture PDFs`, async () => {
    await install(consumer, manager, "pdfjs", [versionSpec("pdfjs-dist"), versionSpec("pdfkit")]);
    await assertInstalled(consumer, "pdfjs", ["ai", "pdfjs-dist", "pdfkit"], ["@napi-rs/canvas"]);
    await exercise(consumer, "loader", loaderRuntime, loaderTypes);
  });
  for (const [manager, consumer] of Object.entries(consumers)) await check(`${manager} packed conformance suite verifies the selected loader`, async () => {
    await install(consumer, manager, "conformance", [versionSpec("vitest")]);
    await assertInstalled(consumer, "conformance", ["ai", "pdfjs-dist", "pdfkit", "vitest"], ["@napi-rs/canvas"]);
    await save(join(consumer, "conformance.test.mjs"), conformanceTest);
    await run(`${manager}-conformance`, join(consumer, "node_modules", ".bin", "vitest"), [
      "run", "conformance.test.mjs", "--maxWorkers=1", "--reporter=json", "--outputFile=conformance-results.json",
    ], consumer);
    const report = await json(join(consumer, "conformance-results.json"));
    assert.equal(report.numFailedTests, 0);
    const assertions = report.testResults.flatMap(result => result.assertionResults);
    for (const title of ["reads a document and finds its content", "reports a text document as digital", "handles a page with no text without throwing"]) {
      assert.equal(assertions.find(result => result.title === title)?.status, "passed", title);
    }
  });
  for (const manager of ["npm", "pnpm"]) await check(`${manager} packed CLI reports its version and inspects a real PDF`, async () => {
    const consumer = join(output, `${manager}-cli`);
    await mkdir(consumer);
    await save(join(consumer, "package.json"), {
      name: `verify-docture-cli-${manager}`, private: true, type: "module", packageManager: rootManifest.packageManager,
    });
    if (manager === "pnpm") await save(join(consumer, "pnpm-workspace.yaml"), `packages:\n  - .\noverrides:\n  docture: ${JSON.stringify(summary.cliResolution.pnpmOverride.docture)}\n  "@docture/eval": ${JSON.stringify(summary.cliResolution.pnpmOverride["@docture/eval"])}\n  "@docture/synthetic": ${JSON.stringify(summary.cliResolution.pnpmOverride["@docture/synthetic"])}\n`);
    await install(consumer, manager, "cli", [packed.docture.target, packed["@docture/eval"].target, packed["@docture/synthetic"].target, packed["@docture/cli"].target, versionSpec("@types/node")]);
    const packages = await installedPackages(consumer);
    await save(join(consumer, "installed.json"), packages);
    assert.deepEqual(packages.filter(pkg => pkg.name.startsWith("@docture/")).map(pkg => pkg.name).sort(), ["@docture/cli", "@docture/eval", "@docture/synthetic"]);
    assert.equal(packages.filter(pkg => pkg.name === "docture").length, 1);
    assert.equal(packages.find(pkg => pkg.name === "docture").version, library.manifest.version);
    const bin = join(consumer, "node_modules", ".bin", "docture");
    const version = await run(`${manager}-cli-version`, bin, ["--version"], consumer);
    assert.equal(version.trim(), cli.manifest.version);
    await save(join(consumer, "docture.eval.mjs"), `import { inMemoryDataset, looseEval } from "@docture/eval";
export default { dataset: inMemoryDataset("packed", [1, 2].map(n => ({ id: String(n), documents: [], expected: { n } }))), spec: looseEval(), experiments: { echo: { id: "echo", async extract(item) { return { raw: item.expected }; } } }, store: ".docture/eval" };`);
    await run(`${manager}-cli-eval-two-cases`, bin, ["eval", "run", "--config", "docture.eval.mjs", "--no-gate"], consumer);
    const runs = join(consumer, ".docture/eval/runs");
    const runIds = await readdir(runs);
    assert.equal(runIds.length, 1, "packed eval run persists one run");
    const result = await json(join(runs, runIds[0], "result.json"));
    assert.equal(result.run.status, "complete");
    const cases = (await readFile(join(runs, runIds[0], "cases.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(cases.map(item => item.outcome), ["scored", "scored"]);
    await run(`${manager}-cli-eval-json`, bin, ["eval", "run", "--config", "docture.eval.mjs", "--reporter", "json", "--out", "eval-results", "--no-gate"], consumer);
    assert.ok((await readdir(join(consumer, "eval-results"))).includes("result.json"), "packed JSON reporter writes result.json");

    const synth = join(consumer, "synth");
    await save(join(synth, "docture.synth.mjs"), `import { defineModel, defineSynthConfig, defineTemplate, gen, locales } from "@docture/synthetic";
const model = defineModel({ type: "object", required: ["name"], properties: { name: { type: "string" } } }, { fields: { name: gen.pick(["Ada", "Grace"]) } });
const slip = defineTemplate()({ key: "slip", family: "slip", locale: locales["en-US"], page: { size: { width: 200, height: 100 } }, printed: { name: true }, draw(page, value) { page.field("name", value.name, { x: 10, y: 10 }); } });
export default defineSynthConfig({ model, templates: [slip], createdAt: "2025-01-01T00:00:00Z" });
`);
    const sampled = await run(`${manager}-cli-synth-gen`, bin, ["synth", "gen", "--seed", "1"], synth);
    assert.ok(["Ada", "Grace"].includes(JSON.parse(sampled).name), sampled);
    assert.equal(await run(`${manager}-cli-synth-gen-again`, bin, ["synth", "gen", "--seed", "1"], synth), sampled, "packed synth gen is reproducible");
    const unrendered = await runFailing(`${manager}-cli-synth-render`, bin, ["synth", "render", "--seed", "1", "--out", "slip.pdf"], synth);
    assert.ok(unrendered.stderr.includes(`@docture/synthetic/pdfkit needs the optional peer pdfkit@${packed["@docture/synthetic"].manifest.peerDependencies.pdfkit}, which is not installed.`), unrendered.stderr);

    const help = await run(`${manager}-cli-help`, bin, ["--help"], consumer);
    assert.match(help, /inspect/); assert.match(help, /extract/);
    const envelope = JSON.parse(await run(`${manager}-cli-inspect`, bin, ["inspect", join(consumers.npm, "invoice.pdf"), "--format", "json", "--text", "--no-config"], consumer));
    assert.deepEqual([envelope.version, envelope.command, envelope.ok, envelope.results.length], [1, "inspect", true, 1]);
    const report = envelope.results[0];
    assert.equal(report.ok, true);
    assert.equal(report.loader, "pdfjs");
    assert.equal(report.features.pageCount, 1);
    assert.equal(report.features.hasTextLayer, true);
    assert.match(report.text, /INVOICE/);
    assert.match(report.text, /INV-2026-/);
    await save(join(consumer, "inspect.json"), envelope);
    await save(join(consumer, "cli-types.ts"), 'type PublicCli = typeof import("@docture/cli");\ndeclare const cli: PublicCli;\nconst version: string = cli.version();\nvoid version;\n');
    await run(`${manager}-cli-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "cli-types.ts"], consumer);
  });
  const invoice = join(consumers.npm, "invoice.pdf");
  await check("npm packed CLI names a missing engine instead of a damaged file", async () => {
    const consumer = join(output, "npm-cli");
    const directory = join(consumer, "missing-engine");
    await save(join(directory, "docture.config.mjs"), cliMissingEngineConfig);
    const bin = join(consumer, "node_modules", ".bin", "docture");
    const range = packed.docture.manifest.peerDependencies.mupdf;
    const missing = await runFailing("npm-cli-missing-engine", bin, ["inspect", invoice], directory);
    assert.ok(missing.stderr.includes(`docture/loaders/mupdf needs the optional peer mupdf@${range}, which is not installed.`), missing.stderr);
    assert.ok(missing.stderr.includes("The file was not read. Install the engine named above"), missing.stderr);
    assert.doesNotMatch(missing.stderr, /corrupt/);
    await save(join(consumer, "broken.pdf"), "%PDF-1.7 this is not a document");
    const damaged = await runFailing("npm-cli-damaged-file", bin, ["inspect", "broken.pdf", "--no-config"], consumer);
    assert.ok(damaged.stderr.includes("it may be corrupt, truncated, or password-protected"), damaged.stderr);
    assert.doesNotMatch(damaged.stderr, /Install the engine/);
  });
  const mcpRange = cli.manifest.peerDependencies["@modelcontextprotocol/sdk"];
  await check("npm packed CLI imports both entries without the MCP SDK and names it only when serving", async () => {
    const consumer = join(output, "npm-cli");
    assert.equal(cli.manifest.peerDependenciesMeta["@modelcontextprotocol/sdk"]?.optional, true);
    assert.deepEqual(await versionOf(consumer, "@modelcontextprotocol/sdk"), []);
    await save(join(consumer, "mcp-absent.mjs"), mcpAbsentRuntime);
    await run("npm-cli-mcp-absent-entries", "node", ["mcp-absent.mjs", mcpRange], consumer);
    const missing = await runFailing("npm-cli-mcp-absent", join(consumer, "node_modules", ".bin", "docture"), ["mcp", "--no-config"], consumer);
    assert.ok(missing.stderr.includes(`@docture/cli/mcp needs the optional peer @modelcontextprotocol/sdk@${mcpRange}, which is not installed.`), missing.stderr);
    assert.equal(missing.stdout, "");
  });
  await check(`npm packed CLI serves convert and inspect over MCP stdio with @modelcontextprotocol/sdk@${mcpRange}`, async () => {
    const consumer = await newConsumer("npm-cli-mcp");
    await install(consumer, "npm", "cli-mcp", [packed.docture.target, packed["@docture/eval"].target, packed["@docture/synthetic"].target, packed["@docture/cli"].target, `@modelcontextprotocol/sdk@${mcpRange}`, versionSpec("@types/node")]);
    assert.deepEqual(await versionOf(consumer, "@modelcontextprotocol/sdk"), [mcpRange]);
    await cp(invoice, join(consumer, "invoice.pdf"));
    await save(join(consumer, "mcp-client.mjs"), mcpClientRuntime);
    await save(join(consumer, "mcp-client.json"), JSON.parse(await run("npm-cli-mcp-client", "node", ["mcp-client.mjs"], consumer)));
    await save(join(consumer, "mcp-types.ts"), mcpTypes);
    await run("npm-cli-mcp-types", tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "mcp-types.ts"], consumer);
  });
  await check("esbuild keeps the MCP SDK out of the root CLI entry's static chunks", async () => {
    const consumer = join(output, "npm-cli-mcp");
    const directory = join(consumer, "bundle-esbuild-cli-root");
    await save(join(consumer, "cli-root-consumer.mjs"), cliRootBundleConsumer);
    // Splitting keeps each dynamic import() in its own chunk, so the entry's static
    // closure is exactly what importing @docture/cli loads.
    const result = await tools.esbuild.build({
      entryPoints: [join(consumer, "cli-root-consumer.mjs")], absWorkingDir: consumer, outdir: directory,
      bundle: true, splitting: true, format: "esm", platform: "node", target: "node22", metafile: true,
      external: ["@napi-rs/*"], logLevel: "silent",
    });
    await save(join(directory, "metafile.json"), result.metafile);
    const outputs = result.metafile.outputs;
    const reached = new Set();
    // Dynamic import targets are entry points too; start from the consumer alone.
    for (const queue = Object.keys(outputs).filter(key => outputs[key].entryPoint === "cli-root-consumer.mjs"); queue.length > 0;) {
      const key = queue.pop();
      if (reached.has(key)) continue;
      reached.add(key);
      queue.push(...outputs[key].imports.filter(item => item.kind === "import-statement" && !item.external).map(item => item.path));
    }
    const sdk = id => id.includes("node_modules/@modelcontextprotocol/");
    const staticInputs = [...reached].flatMap(key => Object.keys(outputs[key].inputs));
    assert.deepEqual(staticInputs.filter(id => sdk(id) || /@docture\/cli\/dist\/mcp\/(?:server|index)\.js$/.test(id)), [], "the root entry loads no MCP code statically");
    assert.ok(Object.values(outputs).some(value => Object.keys(value.inputs).some(sdk)), "the lazy mcp command still reaches the SDK");
  });
  async function loadedModules(label, consumer, args) {
    await save(join(consumer, "module-trace.mjs"), moduleTrace);
    await save(join(consumer, "module-trace-hooks.mjs"), moduleTraceHooks);
    const log = join(consumer, "module-trace.log");
    await save(log, "");
    const stdout = await run(label, "node", ["--import", "./module-trace.mjs", ...args], consumer);
    const home = await realpath(consumer);
    const modules = (await readFile(log, "utf8")).split("\n").filter(Boolean).map(url => {
      const path = fileURLToPath(url);
      const at = path.lastIndexOf(`${sep}node_modules${sep}`);
      return at < 0 ? relative(home, path) : path.slice(at + "/node_modules/".length);
    });
    await save(join(consumer, `${label}-modules.json`), modules);
    return { stdout, modules };
  }
  const isCore = path => path.startsWith("docture/");
  const isMcpSdk = path => path.startsWith("@modelcontextprotocol/");
  await check("npm packed CLI config entry loads no other module and types a consumer config", async () => {
    const consumer = join(output, "npm-cli");
    await exercise(consumer, "cli-config", cliConfigRuntime, cliConfigTypes, 'defineConfig({ instructions: "x" }).instructions ?? ""');
    const { modules } = await loadedModules("npm-cli-config-modules", consumer, ["cli-config.mjs"]);
    assert.deepEqual(modules, ["cli-config.mjs", "@docture/cli/dist/define-config.js"], "importing @docture/cli/config loads only its own file");
  });
  await check("packed HTTP service handles repeated requests and disposes shared engines once", () =>
    exercise(join(output, "npm-cli"), "http-service", serviceRuntime, serviceTypes));
  await check("npm packed CLI help loads neither docture core nor the MCP SDK, with or without the SDK installed", async () => {
    const probe = await loadedModules("npm-cli-inspect-modules", join(output, "npm-cli"),
      [join("node_modules", "@docture", "cli", "dist", "bin.js"), "inspect", invoice, "--no-config", "--format", "json"]);
    assert.ok(probe.modules.some(isCore), "the trace sees docture core when a command loads it");
    for (const [consumer, sdkInstalled] of [[join(output, "npm-cli"), false], [join(output, "npm-cli-mcp"), true]]) {
      assert.deepEqual((await versionOf(consumer, "@modelcontextprotocol/sdk")).length > 0, sdkInstalled);
      const bin = join("node_modules", "@docture", "cli", "dist", "bin.js");
      for (const args of [["help"], ["help", "--json"], ["--help"], ["mcp", "--help"]]) {
        const label = `npm-cli-${sdkInstalled ? "sdk" : "no-sdk"}-${args.join("-").replace(/[^a-z]+/g, "-")}`;
        const { stdout, modules } = await loadedModules(label, consumer, [bin, ...args]);
        if (args.includes("--json")) assert.ok(JSON.parse(stdout).results.some(item => item.file === "inspect"), `${label} prints the command catalog`);
        else assert.match(stdout, args[0] === "mcp" ? /mcp/ : /inspect/, `${label} prints help`);
        assert.ok(modules.includes("@docture/cli/dist/run.js"), `${label} traced the CLI itself`);
        assert.deepEqual(modules.filter(path => isCore(path) || isMcpSdk(path)), [], `${label} loads no docture core or MCP SDK module`);
      }
    }
  });
  await check("npm PaddleOCR without ONNX Runtime names the runtime it needs", async () => {
    const consumer = await newConsumer("npm-paddle-without-onnx");
    await install(consumer, "npm", "paddle-without-onnx", [packed.docture.target, versionSpec("ppu-paddle-ocr")]);
    assert.deepEqual(await versionOf(consumer, "onnxruntime-node"), []);
    await save(join(consumer, "paddle.mjs"), paddleRuntimeWithoutOnnx);
    await run("npm-paddle-without-onnx", "node", ["paddle.mjs"], consumer);
  });
  await check("npm PaddleOCR decodes TIFF with utif2 and rejects malformed TIFF before the engine", async () => {
    const consumer = await newConsumer("npm-paddle-tiff");
    await install(consumer, "npm", "paddle-tiff", [packed.docture.target, versionSpec("utif2")]);
    assert.deepEqual(await versionOf(consumer, "utif2"), [library.manifest.devDependencies.utif2]);
    assert.deepEqual(await versionOf(consumer, "ppu-paddle-ocr"), []);
    await save(join(consumer, "paddle-tiff.mjs"), paddleTiffRuntime);
    await run("npm-paddle-tiff", "node", ["paddle-tiff.mjs"], consumer);
  });
  let canvasAbsent;
  await check("npm canvas rasterizer beside PDF.js without canvas names the canvas it needs", async () => {
    const consumer = await newConsumer("npm-canvas-absent");
    await run("npm-canvas-absent-install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=optional", "--save-exact", packed.docture.target, versionSpec("pdfjs-dist")], consumer);
    await assertInstalled(consumer, "canvas-absent", ["pdfjs-dist"]);
    canvasAbsent = consumer;
    await cp(invoice, join(consumer, "invoice.pdf"));
    await save(join(consumer, "missing-canvas.mjs"), missingCanvasRuntime);
    await save(join(consumer, "missing-canvas.json"), JSON.parse(await run("npm-canvas-absent-rasterizer", "node", ["missing-canvas.mjs"], consumer)));
  });
  await check("canvas-absent consumer rejects a canvas rasterizer without its canvas import", async () => {
    assert.ok(canvasAbsent, "the canvas-absent consumer exists");
    const { consumer } = await mutatedCopy(canvasAbsent, "control-canvas-import-removed", { module: "raster/canvas/rasterizer", edit: removeCanvasImport });
    const exportsOf = async directory => (await run("canvas-import-removed-exports", "node", ["--input-type=module", "-e",
      'console.log(JSON.stringify(Object.keys(await import("docture/raster/canvas")).sort()))'], directory)).trim();
    assert.equal(await exportsOf(consumer), await exportsOf(canvasAbsent), "the mutation keeps the entry's export list");
    await cp(invoice, join(consumer, "invoice.pdf"));
    await save(join(consumer, "missing-canvas.mjs"), missingCanvasRuntime);
    const failure = await runFailing("canvas-import-removed-rasterizer", "node", ["missing-canvas.mjs"], consumer);
    assert.ok(failure.stderr.includes("AssertionError [ERR_ASSERTION]: the canvas rasterizer reports the missing canvas: "), failure.stderr);
  });
  await check("every engine peer is a tested range or a development pin", async () => {
    const peers = packed.docture.manifest.peerDependencies;
    for (const name of pinnedEngines) assert.equal(peers[name], library.manifest.devDependencies[name], `${name} stays pinned to its tested version`);
    assert.deepEqual(Object.keys(engineMatrix.current).sort(), Object.keys(engineMatrix.floor).sort());
    for (const [name, floor] of Object.entries(engineMatrix.floor)) {
      assert.notEqual(peers[name], floor, `${name} declares a range`);
      assert.equal(/\d+\.\d+\.\d+/.exec(peers[name])?.[0], floor, `${name} range starts at its tested floor`);
    }
    const engines = optionalPeers.filter(name => !["ai", "zod", "vitest"].includes(name));
    assert.deepEqual(engines.filter(name => !pinnedEngines.includes(name) && !(name in engineMatrix.floor)), [], "every engine has a verification policy");
    const cliManifest = packed["@docture/cli"].manifest;
    for (const name of coupledEngines.flat()) {
      const pin = cliManifest.dependencies?.[name] ?? cliManifest.optionalDependencies?.[name];
      assert.ok(Object.values(engineMatrix).some(versions => versions[name] === pin), `the CLI's ${name}@${pin} is a version the engine matrix runs`);
    }
  });
  for (const manager of ["npm", "pnpm"]) for (const [tier, versions] of Object.entries(engineTiers)) await check(`${manager} ${tier} engine versions pass the packed conformance suites`, async () => {
    const label = `${manager}-engines-${tierDirectory(tier)}`;
    const consumer = await newConsumer(label);
    await install(consumer, manager, label, [packed.docture.target, ...Object.entries(versions).map(([name, version]) => `${name}@${version}`), versionSpec("vitest")], { strictPeers: true });
    // One copy per engine also means one physical canvas. A package manager installs a
    // second canvas for PDF.js alone when the pair's ranges do not overlap.
    for (const [name, version] of Object.entries(versions)) assert.deepEqual(await versionOf(consumer, name), [version], `${tier} installs ${name}@${version} once`);
    if (manager === "npm") await run(`${label}-tree`, "npm", ["ls", "--all"], consumer);
    await save(join(consumer, "engines.test.mjs"), engineConformanceTest);
    await run(`${label}-conformance`, join(consumer, "node_modules", ".bin", "vitest"), [
      "run", "engines.test.mjs", "--maxWorkers=1", "--reporter=json", "--outputFile=engine-results.json",
    ], consumer);
    const report = await json(join(consumer, "engine-results.json"));
    const assertions = report.testResults.flatMap(result => result.assertionResults);
    assert.equal(report.numFailedTests, 0);
    for (const suite of ["loader conformance: pdfjs", "loader conformance: mupdf", "rasterizer conformance: canvas", "rasterizer conformance: mupdf raster"]) {
      const passed = assertions.filter(result => result.ancestorTitles.includes(suite) && result.status === "passed").length;
      assert.ok(passed > 0, `${suite} passes at ${tier}`);
    }
    await save(join(consumer, "loader.mjs"), loaderRuntime);
    await run(`${label}-loader`, "node", ["loader.mjs"], consumer);
    return { versions, passed: report.numPassedTests };
  });
  for (const manager of ["npm", "pnpm"]) for (const [name, version, runtime, peers] of applicationEngines) await check(`${manager} core-only install works beside an application's ${name}@${version}`, async () => {
    const consumer = await newConsumer(`${manager}-beside-${name}-${version}`);
    await install(consumer, manager, `beside-${name}`, [packed.docture.target, `${name}@${version}`, ...peers.map(versionSpec)], { strictPeers: true });
    assert.deepEqual(await versionOf(consumer, name), [version], `docture uses the application's ${name}`);
    if (manager === "npm") await run(`npm-beside-${name}-tree`, "npm", ["ls", "--all"], consumer);
    await cp(invoice, join(consumer, "invoice.pdf"));
    await save(join(consumer, "adoption.mjs"), runtime);
    await run(`${manager}-beside-${name}-runtime`, "node", ["adoption.mjs"], consumer);
  });
  for (const version of applicationPdfJsVersions) await check(`npm CLI inspects and renders pages beside an application's pdfjs-dist@${version}`, async () => {
    const label = `npm-cli-beside-pdfjs-${version}`;
    const consumer = await newConsumer(label);
    await install(consumer, "npm", label, [packed.docture.target, packed["@docture/eval"].target, packed["@docture/synthetic"].target, packed["@docture/cli"].target, `pdfjs-dist@${version}`, versionSpec("ai")]);
    await run(`${label}-tree`, "npm", ["ls", "--all"], consumer);
    assert.deepEqual(await versionOf(consumer, "@napi-rs/canvas"), [packed["@docture/cli"].manifest.optionalDependencies["@napi-rs/canvas"]],
      "PDF.js and the rasterizer share the CLI's canvas");
    const bin = join(consumer, "node_modules", ".bin", "docture");
    const envelope = JSON.parse(await run(`${label}-inspect`, bin, ["inspect", invoice, "--format", "json", "--text", "--no-config"], consumer));
    assert.deepEqual([envelope.version, envelope.command, envelope.ok, envelope.results.length], [1, "inspect", true, 1]);
    const report = envelope.results[0];
    assert.equal(report.ok, true);
    assert.equal(report.loader, "pdfjs");
    assert.match(report.text, /INVOICE/);
    await save(join(consumer, "schema.json"), cliPeerContexts.schema);
    await save(join(consumer, "vision", "docture.config.mjs"), cliVisionConfig);
    const rendered = JSON.parse(await run(`${label}-vision`, bin, ["extract", invoice, "--schema", "../schema.json", "--format", "ndjson", "--full", "--vision"], join(consumer, "vision")));
    assert.equal(rendered.method, "vision");
    assert.deepEqual(rendered.data, { invoiceNumber: "INV-1" }, "the mocked vision model received one rendered page");
  });
  await check(`npm rejects an engine outside its supported range (${unsupportedEngine})`, async () => {
    const consumer = await newConsumer("npm-unsupported-engine");
    const failure = await runFailing("npm-unsupported-engine-install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", packed.docture.target, unsupportedEngine], consumer);
    assert.match(failure.stderr, /ERESOLVE/);
    assert.ok(failure.stderr.includes(`peerOptional pdfjs-dist@"${packed.docture.manifest.peerDependencies["pdfjs-dist"]}"`), failure.stderr);
  });
  await check("npm rejects an application's own OCR engine release beside the exact OCR peers", async () => {
    for (const [name, version] of Object.entries(applicationOcrEngines)) {
      const consumer = await newConsumer(`npm-ocr-conflict-${name}`);
      const failure = await runFailing(`npm-ocr-conflict-${name}-install`, "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", packed.docture.target, versionSpec("zod"), `${name}@${version}`], consumer);
      assert.match(failure.stderr, /ERESOLVE/);
      assert.ok(failure.stderr.includes(`peerOptional ${name}@"${packed.docture.manifest.peerDependencies[name]}"`), failure.stderr);
    }
  });
  const ocrOverride = await check("npm core works beside an application's own OCR engines with the documented override", async () => {
    const recipes = await Promise.all(["installation", "migration"].map(async guide => {
      const source = await readFile(join(root, "apps/docs/content/docs/guides", `${guide}.mdx`), "utf8");
      const recipe = /```json\n(\{\n\s+"overrides"[\s\S]*?)```/.exec(source)?.[1];
      assert.ok(recipe, `the ${guide} guide shows the npm override for an application's own OCR engine`);
      return JSON.parse(recipe);
    }));
    assert.deepEqual(recipes[0], recipes[1], "both guides show the same override");
    const documented = Object.entries(recipes[0].overrides.docture);
    assert.ok(documented.length > 0 && documented.every(([name, reference]) => name in applicationOcrEngines && reference === `$${name}`),
      "the documented entry gives docture the application's own version of an OCR engine");
    const consumer = await newConsumer("npm-ocr-override");
    const declared = name => versionSpec(name).slice(name.length + 1);
    const override = Object.fromEntries(Object.keys(applicationOcrEngines).map(name => [name, `$${name}`]));
    await save(join(consumer, "package.json"), {
      ...await json(join(consumer, "package.json")),
      dependencies: { docture: `file:${packed.docture.target}`, zod: declared("zod"), "@types/node": declared("@types/node"), ...applicationOcrEngines },
      overrides: { docture: override },
    });
    await run("npm-ocr-override-install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
    await run("npm-ocr-override-tree", "npm", ["ls", "--all"], consumer);
    for (const [name, version] of Object.entries(applicationOcrEngines)) assert.deepEqual(await versionOf(consumer, name), [version], `docture shares the application's ${name}`);
    await exercise(consumer, "core", coreRuntime, coreTypes, "result.data.invoice");
    return override;
  });
  async function cliOnlyBesideOcrEngines(label, doctureOverride) {
    const consumer = await newConsumer(label);
    await save(join(consumer, "package.json"), {
      ...await json(join(consumer, "package.json")),
      dependencies: { "@docture/cli": `file:${packed["@docture/cli"].target}`, ...applicationOcrEngines },
      overrides: { docture: doctureOverride, "@docture/eval": `file:${packed["@docture/eval"].target}`, "@docture/synthetic": `file:${packed["@docture/synthetic"].target}` },
    });
    await run(`${label}-install`, "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
    await run(`${label}-tree`, "npm", ["ls", "--all"], consumer);
    const lock = await json(join(consumer, "package-lock.json"));
    const integrity = "sha512-" + createHash("sha512").update(await readFile(packed.docture.target)).digest("base64");
    assert.deepEqual(Object.entries(lock.packages).filter(([path]) => basename(path) === "docture").map(([, entry]) => entry.integrity), [integrity],
      "the CLI installs the packed library rather than the registry release");
    return consumer;
  }
  await check("npm CLI-only install beside an application's own OCR engines adds a second copy of each pinned engine", async () => {
    const consumer = await cliOnlyBesideOcrEngines("npm-cli-only-ocr", `file:${packed.docture.target}`);
    for (const [name, version] of Object.entries(applicationOcrEngines)) {
      assert.deepEqual((await versionOf(consumer, name)).sort(), [version, packed.docture.manifest.peerDependencies[name]].sort(), `npm adds docture's pinned ${name} beside the application's`);
    }
  });
  await check("npm CLI-only install beside an application's own OCR engines keeps one copy of each with the documented override", async () => {
    assert.ok(ocrOverride, "the documented override passed the core check");
    const consumer = await cliOnlyBesideOcrEngines("npm-cli-only-ocr-override", { ".": `file:${packed.docture.target}`, ...ocrOverride });
    for (const [name, version] of Object.entries(applicationOcrEngines)) assert.deepEqual(await versionOf(consumer, name), [version], `docture shares the application's ${name}`);
    const envelope = JSON.parse(await run("npm-cli-only-ocr-override-inspect", join(consumer, "node_modules", ".bin", "docture"), ["inspect", invoice, "--format", "json", "--text", "--no-config"], consumer));
    assert.deepEqual([envelope.version, envelope.command, envelope.ok, envelope.results.length], [1, "inspect", true, 1]);
    assert.match(envelope.results[0].text, /INVOICE/);
  });
  await check("pnpm installs an application's own OCR engine release with an unmet-peer warning", async () => {
    const consumer = await newConsumer("pnpm-ocr-conflict");
    const version = applicationOcrEngines["tesseract.js"];
    const warning = `unmet peer tesseract.js@${packed.docture.manifest.peerDependencies["tesseract.js"]}: found ${version}`;
    const report = await install(consumer, "pnpm", "ocr-conflict", [packed.docture.target, versionSpec("zod"), `tesseract.js@${version}`]);
    assert.ok(report.includes(warning), report);
    assert.throws(() => assertNoPeerConflicts(report, "ocr-conflict"), /installs without peer conflicts/, "the strict peer check rejects a real conflict");
    await save(join(consumer, "core.mjs"), coreRuntime);
    await run("pnpm-ocr-conflict-core", "node", ["core.mjs"], consumer);
    await install(await newConsumer("pnpm-ocr-conflict-control"), "pnpm", "ocr-conflict-control",
      [packed.docture.target, versionSpec("zod"), versionSpec("tesseract.js")], { strictPeers: true });
  });
  for (const [manager, version] of zodMatrix) await check(`${manager} Zod ${version} installs by default and runs model classification`, async () => {
    const consumer = await newConsumer(`${manager}-zod-${version}`);
    await install(consumer, manager, `zod-${version}`, [packed.docture.target, versionSpec("ai"), `zod@${version}`, versionSpec("@types/node")], { strictPeers: true });
    assert.deepEqual(await versionOf(consumer, "zod"), [version]);
    if (manager === "npm") await run(`npm-zod-${version}-tree`, "npm", ["ls", "--all"], consumer);
    await exercise(consumer, "classifier", classifierRuntime, classifierTypes, "result.data.invoice");
  });
  const cliCanvas = packed["@docture/cli"].manifest.optionalDependencies["@napi-rs/canvas"];
  const pdfjsCanvas = Object.values(engineMatrix).map(versions => versions["@napi-rs/canvas"]).find(version => version !== cliCanvas);
  let peerContexts;
  await check("pnpm CLI config from an application with another AI SDK keeps usage, codes, hints and fallback", async () => {
    const consumer = await newConsumer("pnpm-cli-peer-contexts");
    // pnpm resolves PDF.js's own canvas apart from the CLI's canvas. Pinning it to another
    // tested release keeps two physical canvases in this install.
    await save(join(consumer, "pnpm-workspace.yaml"), `packages:\n  - .\noverrides:\n  docture: ${JSON.stringify(summary.cliResolution.pnpmOverride.docture)}\n  "@docture/eval": ${JSON.stringify(summary.cliResolution.pnpmOverride["@docture/eval"])}\n  "@docture/synthetic": ${JSON.stringify(summary.cliResolution.pnpmOverride["@docture/synthetic"])}\n  "pdfjs-dist>@napi-rs/canvas": ${JSON.stringify(pdfjsCanvas)}\n`);
    await install(consumer, "pnpm", "cli-peer-contexts", [packed.docture.target, packed["@docture/eval"].target, packed["@docture/synthetic"].target, packed["@docture/cli"].target, `ai@${applicationAiVersion}`, versionSpec("pdfjs-dist"), versionSpec("zod"), versionSpec("@types/node")]);
    peerContexts = consumer;
    const store = join(consumer, "node_modules", ".pnpm");
    const copies = (await readdir(store)).filter(name => name.startsWith("docture@"));
    assert.equal(copies.length, 2, "the application and the CLI resolve separate docture peer contexts");
    const aiVersions = await Promise.all(copies.map(async name => (await json(join(await realpath(join(store, name, "node_modules", "ai")), "package.json"))).version));
    assert.deepEqual(aiVersions.sort(), [cli.manifest.dependencies.ai, applicationAiVersion].sort());
    await save(join(consumer, "probe.mjs"), cliPeerContexts.probe);
    await save(join(consumer, "peer-contexts.json"), JSON.parse(await run("pnpm-peer-contexts-probe", "node", ["probe.mjs"], consumer)));
    await save(join(consumer, "schema.json"), cliPeerContexts.schema);
    for (const name of ["usage", "noStrategy", "timeout"]) await save(join(consumer, name, "docture.config.mjs"), cliPeerContexts[name]);
    const bin = join(consumer, "node_modules", ".bin", "docture");
    const extract = ["extract", invoice, "--schema", "../schema.json", "--format", "ndjson"];
    const usage = JSON.parse(await run("pnpm-peer-contexts-usage", bin, [...extract, "--full"], join(consumer, "usage")));
    assert.deepEqual([usage.usage.inputTokens, usage.usage.outputTokens], [2010, 505]);
    assert.deepEqual(usage.attempts.map(({ strategy, status, errorCode, usage: spent }) => ({ strategy, status, errorCode, inputTokens: spent?.inputTokens })), [
      { strategy: "bad", status: "failed", errorCode: "MODEL_OUTPUT_FAILED", inputTokens: 1000 },
      { strategy: "bad", status: "failed", errorCode: "MODEL_OUTPUT_FAILED", inputTokens: 1000 },
      { strategy: "good", status: "ok", errorCode: undefined, inputTokens: 10 },
    ]);
    const unreadable = await runFailing("pnpm-peer-contexts-codes", bin, extract, join(consumer, "noStrategy"));
    assert.equal(JSON.parse(unreadable.stdout).error.code, "NO_ELIGIBLE_STRATEGY");
    assert.ok(unreadable.stderr.includes("The document loaded but nothing wired can read it."), unreadable.stderr);
    const fallback = JSON.parse(await run("pnpm-peer-contexts-timeout", bin, [...extract, "--full"], join(consumer, "timeout")));
    assert.equal(fallback.method, "good");
    assert.deepEqual(fallback.attempts.map(({ strategy, errorCode }) => ({ strategy, errorCode })), [
      { strategy: "nested", errorCode: "TIMEOUT" },
      { strategy: "good", errorCode: undefined },
    ]);
  });
  await check("pnpm CLI renders pages from a config loader in the application's docture copy", async () => {
    assert.ok(peerContexts, "the peer-context consumer exists");
    const installed = (await versionOf(peerContexts, "@napi-rs/canvas")).sort();
    await save(join(peerContexts, "canvases.mjs"), cliPeerContexts.canvases);
    const resolved = JSON.parse(await run("pnpm-peer-contexts-canvases", "node", ["canvases.mjs"], peerContexts));
    await save(join(peerContexts, "canvas-copies.json"), { installed, resolved });
    assert.deepEqual(installed, [cliCanvas, pdfjsCanvas].sort(), "the install holds two physical canvases");
    assert.deepEqual([resolved.rasterizer.version, resolved.pdfjs.version], [cliCanvas, pdfjsCanvas], "the CLI's rasterizer imports its own canvas and PDF.js loads the other");
    await save(join(peerContexts, "vision", "docture.config.mjs"), cliApplicationLoaderVisionConfig);
    const rendered = JSON.parse(await run("pnpm-peer-contexts-vision", join(peerContexts, "node_modules", ".bin", "docture"),
      ["extract", invoice, "--schema", "../schema.json", "--format", "ndjson", "--full", "--vision"], join(peerContexts, "vision")));
    assert.equal(rendered.method, "vision");
    assert.deepEqual(rendered.data, { invoiceNumber: "INV-1" }, "the mocked vision model received one rendered page");
  });
  await check("pnpm typed CLI configs accept extractors and converters from the application's docture copy", async () => {
    assert.ok(peerContexts, "the peer-context consumer exists");
    const typed = async files => {
      for (const [name, value] of Object.entries(files)) await save(join(peerContexts, "typed", name), typeof value === "string" ? value : value.source);
      return Object.keys(files).map(name => join("typed", name));
    };
    const doctureConfigs = await typed(typedCliConfigs.docture);
    const componentConfigs = await typed(typedCliConfigs.components);
    await typed(typedCliConfigs.invalid);
    const strict = ["--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node"];
    const compilers = { "typescript-7": [tsc], "typescript-5": [process.execPath, join(root, "node_modules", "typescript-compiler", "bin", "tsc")] };
    for (const [compiler, [command, ...script]] of Object.entries(compilers)) {
      await run(`pnpm-typed-docture-configs-${compiler}`, command, [...script, ...strict, "--skipLibCheck", "false", ...doctureConfigs], peerContexts);
      // The model components bring the application's AI SDK beside the CLI's, and the two
      // releases declare the same globals with different types inside their own .d.ts files.
      await run(`pnpm-typed-component-configs-${compiler}`, command, [...script, ...strict, "--skipLibCheck", ...componentConfigs], peerContexts);
      for (const [name, rejection] of Object.entries(typedCliConfigs.invalid)) {
        await run(`pnpm-typed-${basename(name, ".config.ts")}-${compiler}`, command, [...script, ...strict, "--skipLibCheck", "false", join("typed", name)], peerContexts, rejection);
      }
    }
    const bin = join(peerContexts, "node_modules", ".bin", "docture");
    const extraction = join(peerContexts, "typed-extract");
    await mkdir(extraction);
    const extracted = JSON.parse(await run("pnpm-typed-extractor-run", bin,
      ["extract", invoice, "--schema", "../schema.json", "--format", "ndjson", "--config", "../typed/extractor-async.config.ts"], extraction));
    assert.deepEqual(extracted.data, { invoiceNumber: "INV-TYPED" });
    assert.equal(await readFile(join(extraction, "extractor-disposed.txt"), "utf8"), "disposed");
    const conversion = join(peerContexts, "typed-convert");
    await mkdir(conversion);
    await run("pnpm-typed-converter-run", bin, ["convert", invoice, "--out", "out", "--to", "txt", "--config", "../typed/converter-async.config.ts"], conversion);
    assert.match(await readFile(join(conversion, "out", "invoice.txt"), "utf8"), /INVOICE/);
    assert.equal(await readFile(join(conversion, "converter-disposed.txt"), "utf8"), "disposed");
  });
  await check("both installed consumer guides typecheck and execute", () => verifyConsumerGuides({ consumer: peerContexts, run, save, tools, tsc }));
}

try {
  await main();
  const failed = summary.checks.filter(item => item.status === "failed").map(item => item.name);
  assert.deepEqual(failed, [], "every packed-package check passes");
  summary.status = "passed";
} catch (error) {
  summary.status = "failed";
  summary.error = error.stack ?? String(error);
  console.error(summary.error);
  process.exitCode = 1;
} finally {
  summary.finishedAt = new Date().toISOString();
  if (!values["keep-installs"]) {
    try {
      await cleanupConsumerInstalls(output);
      summary.consumerInstalls = "removed";
    } catch (error) {
      summary.status = "failed";
      summary.cleanupError = error.stack ?? String(error);
      console.error(summary.cleanupError);
      process.exitCode = 1;
    }
  } else summary.consumerInstalls = "retained by --keep-installs";
  await checkpoint();
  console.log(`Evidence ${join(output, "summary.json")}`);
}
