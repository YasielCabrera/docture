import { evalEntryRuntime, evalTypes, evalIdentityRuntime, evalJudgeTypes } from "./verify-packages-consumers.mjs";
import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

export const additionalRuntime = String.raw`
import assert from "node:assert/strict";
import { writeFile, readFile, cp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import * as core from "docture";
import * as node from "docture/node";
import { importDoclingDocument, DoclingImportError } from "docture/import/docling";
import { DoclingServeClient, DoclingServeError } from "docture/loaders/docling";
import { DocumentLoaderAzureRead, AzureReadError } from "docture/loaders/azure-di";
import { DocumentLoaderMammoth, MammothDocumentError } from "docture/loaders/mammoth";
import { expandEmail, EmailInputError } from "docture/inputs/email";
import { PaperlessSource, PaperlessError } from "docture/sources/paperless";
import { extractTool } from "docture/llm/tool";
import { chunkDocument } from "docture/chunk";
import { z } from "zod";
assert.equal(core.DoctureError, node.DoctureError);
assert.equal(core.UnsupportedSourceError, node.UnsupportedSourceError);
await writeFile("local.txt", "packed source text");
for (const source of ["local.txt", pathToFileURL(process.cwd()+"/local.txt")]) {
  assert.equal((await node.resolveSource(source)).fileName, "local.txt");
  await assert.rejects(core.resolveSource(source), core.UnsupportedSourceError);
  const extractor = node.createCheckedExtractor({loaders:[new core.DocumentLoaderData()],strategies:[{name:"echo",async extract(ctx){return {data:{text:ctx.document.text}};}}]});
  assert.deepEqual((await extractor.extract(source,z.object({text:z.string()}))).data,{text:"packed source text"});
  await extractor.dispose();
}
let network = 0;
const noNetwork = async () => { network++; throw new Error("unexpected startup I/O"); };
new DoclingServeClient({baseUrl:"https://example.test",fetch:noNetwork});
new PaperlessSource({baseUrl:"https://example.test",apiVersion:10,fetch:noNetwork});
new DocumentLoaderAzureRead({endpoint:"https://example.test",auth:{kind:"key",key:"test"},fetch:noNetwork});
new DocumentLoaderMammoth();
assert.equal(network,0);
const fixture={schema_name:"DoclingDocument",version:"1.10.0",name:"packed",body:{self_ref:"#/body",children:[{$ref:"#/texts/0"}]},furniture:{self_ref:"#/furniture",children:[]},texts:[{self_ref:"#/texts/0",label:"text",text:"Exact native evidence",prov:[]}],tables:[],pictures:[],groups:[],pages:{}};
const imported=importDoclingDocument(fixture);
assert.equal(imported.source.loaded.pages[0].text,"Exact native evidence");
const parsed=core.parseDoctureDocument(JSON.parse(JSON.stringify(imported.document)));
assert.equal(parsed.ok,true);
assert.ok(chunkDocument(parsed.document,{budget:{unit:"characters",max:200}}).flatMap(chunk=>chunk.evidence??[]).some(item=>item.text==="Exact native evidence"));
const nativeConverter=new core.DocumentConverter();
try {
 const converted=await nativeConverter.convert(imported.source,{format:"json"});
 assert.deepEqual(converted.pages[0].evidence,imported.document.pages[0].evidence);
 assert.deepEqual(chunkDocument(converted,{budget:{unit:"characters",max:200}}),chunkDocument(parsed.document,{budget:{unit:"characters",max:200}}));
}finally{await nativeConverter.dispose();}
assert.equal(typeof extractTool({extractor:new core.Extractor(),contract:z.object({value:z.string()}),resolveSource:()=>new Uint8Array([1])}).execute,"function");
const errors=[
  ["docture/import/docling","DoclingImportError",["$","invalid"]],
  ["docture/loaders/docling","DoclingServeError",["protocol","invalid"]],
  ["docture/loaders/azure-di","AzureReadError",["invalid"]],
  ["docture/loaders/mammoth","MammothDocumentError",["invalid"]],
  ["docture/inputs/email","EmailInputError",["invalid"]],
  ["docture/sources/paperless","PaperlessError",["invalid"]],
];
await cp("node_modules/docture","node_modules/foreign-docture",{recursive:true,dereference:true});
try {
 for(const [entry,name,args] of errors){
  const local=(await import(entry))[name];
  const foreign=(await import(entry.replace("docture","foreign-docture")))[name];
  assert.notEqual(local,foreign);
  const error=new foreign(...args);
  assert.ok(error instanceof local);
  assert.ok(error instanceof core.DoctureError);
  assert.equal(Object.hasOwn(local,"doctureErrorIdentity"),true);
  assert.equal({name,code:error.code} instanceof local,false);
 }
}finally{await rm("node_modules/foreign-docture",{recursive:true,force:true});}
console.log("packed portable/Node sources, native evidence, idle adapters and cross-copy identities pass");
`;

export const additionalTypes = String.raw`
import { createCheckedExtractor, DocumentLoaderData, DocumentConverter, defineStrategy, type SourceResolver, type SourceEvidence, type LoadedDocument, type ConversionWarning } from "docture";
import { resolveNodeSource } from "docture/node";
import { vision } from "docture/llm/vision";
import { extractTool } from "docture/llm/tool";
import { importDoclingDocument } from "docture/import/docling";
import { PaperlessSource } from "docture/sources/paperless";
import type { LanguageModel } from "ai";
import { z } from "zod";
const text=new DocumentLoaderData();
const image=defineStrategy({name:"image",requires:["RENDERABLE_PAGES"],async extract(){return {data:{}};}});
// @ts-expect-error Literal text-only wiring cannot meet an image requirement.
createCheckedExtractor({loaders:[text],strategies:[image]});
declare const model:LanguageModel;
// @ts-expect-error The functional vision helper preserves its literal requirement.
createCheckedExtractor({loaders:[text],strategies:[vision({model})]});
const extractor=createCheckedExtractor({loaders:[text],strategies:[{name:"text",async extract(){return {data:{value:"packed"}};}}]});
const resolver:SourceResolver=resolveNodeSource;
const tools={extract:extractTool({extractor,contract:z.object({value:z.string()}),resolveSource:resolver})};
const loaded:LoadedDocument={pages:[],text:"",form:"scanned",loader:"fixture",conversionWarnings:[] satisfies ConversionWarning[]};
const converted=await new DocumentConverter().convert({loaded},{format:"json"});
const evidence:readonly SourceEvidence[]|undefined=converted.pages[0]?.evidence;
void evidence;void tools;void importDoclingDocument;void PaperlessSource;
`;

export async function verifyConsumerGuides({ consumer, run, save, tools, tsc }) {
  for (const [label, name] of [["library", "docture"], ["cli", "@docture/cli"]]) {
    const guide = await readFile(join(consumer, "node_modules", name, "AGENTS.md"), "utf8");
    assert.match(guide, /Codex/);
    assert.match(guide, /llms\.txt/);
    const snippet = /```ts\n([\s\S]*?)```/.exec(guide)?.[1];
    assert.ok(snippet, `${name} guide has an executable TypeScript consumer`);
    const file = `guide-${label}`;
    await save(join(consumer, `${file}.ts`), snippet);
    await run(`${file}-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", `${file}.ts`], consumer);
    const compiled = tools.ts.transpileModule(snippet, { compilerOptions: { target: tools.ts.ScriptTarget.ES2023, module: tools.ts.ModuleKind.ESNext } }).outputText;
    await save(join(consumer, `${file}.mjs`), compiled);
    const output = await run(`${file}-runtime`, "node", [`${file}.mjs`], consumer);
    if (label === "library") assert.equal(output.trim(), "Hello");
  }
}

export async function verifyPortableBundles({ consumer, tools, run, save, tsc }) {
  const contents = `export * as core from "docture"; export * as chunk from "docture/chunk";`;
  const entry = join(consumer, "portable-entry.mjs");
  await save(entry, contents);
  for (const bundler of ["esbuild", "rollup"]) {
    let code;
    if (bundler === "esbuild") {
      const bundle = await tools.esbuild.build({ entryPoints: [entry], bundle: true, platform: "browser", conditions: ["browser"], format: "iife", globalName: "portable", minify: true, write: false, metafile: true });
      assert.deepEqual(Object.values(bundle.metafile.inputs).flatMap((input) => input.imports).filter((item) => item.path.startsWith("node:")), []);
      assert.deepEqual(Object.values(bundle.metafile.outputs).flatMap((output) => output.imports), []);
      await save(join(consumer, "portable-esbuild-metafile.json"), bundle.metafile);
      code = bundle.outputFiles[0].text;
    } else {
      const bundle = await tools.rollup.rollup({ input: entry, plugins: [tools.resolve.nodeResolve({ browser: true, exportConditions: ["browser"] }), tools.commonjs.default()], onwarn(warning) { if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message); } });
      try {
        const generated = await bundle.generate({ format: "iife", name: "portable", inlineDynamicImports: true });
        const chunk = generated.output.find((item) => item.type === "chunk");
        assert.ok(chunk);
        assert.deepEqual(chunk.imports, []);
        assert.deepEqual(chunk.dynamicImports, []);
        assert.equal(Object.keys(chunk.modules).some((id) => id.startsWith("node:")), false);
        await save(join(consumer, "portable-rollup-modules.json"), Object.keys(chunk.modules));
        code = chunk.code;
      } finally { await bundle.close(); }
    }
    await save(join(consumer, `portable-${bundler}.js`), code);
    const context = { TextEncoder, TextDecoder, URL, AbortController, fetch, performance, setTimeout, clearTimeout, console };
    runInNewContext(code, context);
    const actual = await runInNewContext(`(async()=>{
      const {core,chunk}=portable;
      const source=await core.resolveSource(new Uint8Array([65,66,67]));
      const local=await core.resolveSource("local.txt").catch(core.errorCodeOf);
      const converter=new core.DocumentConverter({loaders:[new core.DocumentLoaderData()]});
      const result=await converter.convert({bytes:new Uint8Array([72,105]),mimeType:"text/plain"},{format:"json"});
      const chunks=chunk.chunkDocument(result,{budget:{unit:"characters",max:200}});
      return JSON.stringify({mime:source.mimeType,local,text:chunks[0].text});
    })()`, context);
    assert.deepEqual(JSON.parse(actual), { mime: "application/octet-stream", local: "UNSUPPORTED_SOURCE", text: "Hi" });
  }
  await save(join(consumer, "portable-types.ts"), 'import { Extractor, type DocumentSource } from "docture"; import { chunkDocument } from "docture/chunk"; const source:DocumentSource=new Uint8Array([1]); const extractor=new Extractor(); void source;void extractor;void chunkDocument;\n');
  await save(join(consumer, "portable-types.json"), { compilerOptions: { strict: true, noEmit: true, module: "ESNext", moduleResolution: "Bundler", target: "ES2023", lib: ["ES2023", "DOM", "ESNext.Disposable"], types: [], skipLibCheck: true }, files: ["portable-types.ts"] });
  await run("portable-browser-types", tsc, ["-p", "portable-types.json"], consumer);
  /** @type {Array<[string, string, RegExp]>} */
  const portableEntries = [
    ["paperless-read", "docture/sources/paperless", /^(core|paperless|sources\/paperless)\//],
    ["docling-import", "docture/import/docling", /^(core|import\/docling)\//],
    ["docling-service", "docture/loaders/docling", /^(core|import\/docling|loaders\/docling)\//],
    ["azure-read", "docture/loaders/azure-di", /^(core|loaders\/azure-di)\//],
    ["extraction-tool", "docture/llm/tool", /^(core|llm\/tool)/],
  ];
  for (const [label, specifier, allowed] of portableEntries) {
    const entry = join(consumer, `${label}.mjs`);
    await save(entry, `export * as api from ${JSON.stringify(specifier)};`);
    for (const bundler of ["esbuild", "rollup"]) {
      let modules;
      if (bundler === "esbuild") {
        const result = await tools.esbuild.build({ entryPoints: [entry], bundle: true, platform: "browser", conditions: ["browser"], format: "esm", minify: true, write: false, metafile: true });
        modules = Object.keys(result.metafile.inputs);
        assert.deepEqual(Object.values(result.metafile.outputs).flatMap((output) => output.imports), []);
      } else {
        const build = await tools.rollup.rollup({ input: entry, plugins: [tools.resolve.nodeResolve({ browser: true, exportConditions: ["browser"] }), tools.commonjs.default()], onwarn(warning) { if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message); } });
        try {
          const output = await build.generate({ format: "esm", inlineDynamicImports: true });
          const chunks = output.output.filter((item) => item.type === "chunk");
          assert.deepEqual(chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports]), []);
          modules = chunks.flatMap((chunk) => Object.entries(chunk.modules).filter(([, details]) => details.renderedLength > 0).map(([path]) => path));
        } finally { await build.close(); }
      }
      for (const path of modules) {
        const normalized = path.replaceAll("\\", "/");
        assert.equal(normalized.startsWith("node:"), false, `${label} has no Node runtime imports`);
        const own = /\/node_modules\/docture\/dist\/(.+)\.js$/.exec(normalized)?.[1];
        if (own !== undefined) assert.match(own, allowed, `${label} reaches only its narrow implementation and core`);
        assert.doesNotMatch(normalized, /\/node_modules\/(?:ai|pdfjs-dist|mupdf|tesseract\.js|ppu-paddle-ocr|onnxruntime-node|@napi-rs\/canvas|mammoth|postal-mime)\//, `${label} has no unrelated engine contribution`);
      }
      await save(join(consumer, `${label}-${bundler}-modules.json`), modules);
    }
  }
}

export const serviceRuntime = String.raw`
import assert from "node:assert/strict";
import {captureIo} from "@docture/cli";
import {createHttpService} from "@docture/cli/service";
import {DocumentLoaderData} from "docture";
import {jsonSchema} from "ai";
let disposed=0;
const data=new DocumentLoaderData();
const loader={name:data.name,capabilities:data.capabilities,load:data.load.bind(data),async dispose(){disposed++;}};
const config={path:process.cwd()+"/config.mjs",config:{loaders:[loader],strategies:[{name:"echo",async extract(ctx){return {data:{text:ctx.document.text}};}}]}};
const service=createHttpService({io:captureIo(),config,schemas:{note:jsonSchema({type:"object",properties:{text:{type:"string"}},required:["text"]})},port:0});
const address=await service.start();
try{
 for(let i=0;i<2;i++){
  const response=await fetch(address.url+"/extract",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({document:{data:Buffer.from("Packed service text").toString("base64"),mimeType:"text/plain"},schema:"note"})});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.results[0].data.text,"Packed service text");
 }
 assert.equal(disposed,0);
}finally{await service.close();}
assert.equal(disposed,1);
console.log("packed HTTP service repeated requests and exactly-once disposal pass");
`;
export const serviceTypes = String.raw`
import {captureIo} from "@docture/cli";
import {createHttpService,type HttpService,type HttpServiceOptions,type HttpServiceAddress} from "@docture/cli/service";
const options:HttpServiceOptions={io:captureIo(),port:0};
const service:HttpService=createHttpService(options);
const address:HttpServiceAddress=await service.start();
void address;await service.close();
`;

export async function verifyEvalPackage({ packed, tools, check, newConsumer, install, save, run, tsc, versionSpec, assertInstalled }) {
  const manifest = packed["@docture/eval"].manifest;

  for (const manager of ["npm", "pnpm"]) {
    const consumer = await newConsumer(`${manager}-eval-engine-free`);
    await check(`${manager} every packed eval entry loads and declarations for every entry work without engines`, async () => {
      await install(consumer, manager, "eval-engine-free", [packed.docture.target, packed["@docture/eval"].target, versionSpec("@types/node")]);
      await assertInstalled(consumer, "eval-engine-free", []);
      await save(join(consumer, "eval-entries.mjs"), evalEntryRuntime(manifest.exports));
      await run(`${manager}-eval-entries`, "node", ["eval-entries.mjs"], consumer);
      await save(join(consumer, "eval-types.ts"), evalTypes(manifest.exports));
      await run(`${manager}-eval-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "eval-types.ts"], consumer);
      await save(join(consumer, "eval-identity.mjs"), evalIdentityRuntime);
      await run(`${manager}-eval-identity`, "node", ["eval-identity.mjs"], consumer);
      await save(join(consumer, "eval-offline.mjs"), evalOfflineRuntime);
      await run(`${manager}-eval-offline`, "node", ["eval-offline.mjs"], consumer);
    });
    await check(`${manager} judge declarations type-check against the exact ai version`, async () => {
      const judgeConsumer = await newConsumer(`${manager}-eval-judge`);
      await install(judgeConsumer, manager, "eval-judge", [packed.docture.target, packed["@docture/eval"].target, versionSpec("ai"), versionSpec("@types/node")]);
      await assertInstalled(judgeConsumer, "eval-judge", ["ai"]);
      await save(join(judgeConsumer, "eval-judge.ts"), evalJudgeTypes);
      await run(`${manager}-eval-judge-types`, tsc, ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "eval-judge.ts"], judgeConsumer);
    });
    if (manager !== "npm") continue;
    const mutation = await newConsumer("eval-root-mutation");
    for (const item of await readdir(join(consumer, "node_modules"))) {
      if (item === "@docture") continue;
      await mkdir(join(mutation, "node_modules"), { recursive: true });
      await symlink(join(consumer, "node_modules", item), join(mutation, "node_modules", item), "dir");
    }
    const library = join(mutation, "node_modules/@docture/eval");
    await cp(join(consumer, "node_modules/@docture/eval"), library, { recursive: true, dereference: true });
    const target = join(library, manifest.exports["."].import);
    await save(join(library, "dist/judge/boundary-control.js"), 'export const forbiddenJudgeControl = () => "judge contribution";');
    await save(target, await readFile(target, "utf8") + '\nexport { forbiddenJudgeControl } from "./judge/boundary-control.js";\n');
    for (const subpath of Object.keys(manifest.exports).filter(key => key === "./runner" || key.startsWith("./reporters/"))) {
      const destination = join(library, manifest.exports[subpath].import);
      const original = await readFile(destination, "utf8");
      const depth = subpath === "./runner" ? "../" : "../../";
      await save(destination, original + `\nexport { forbiddenJudgeControl } from "${depth}judge/boundary-control.js";\n`);
      try {
        for (const bundler of ["esbuild", "rollup"]) await check(`${bundler} ${subpath} production isolation and mutation control`, async () => {
          const allowed = subpath === "./runner" ? ["runner", "dataset", "comparison"] : [subpath.slice(2), "reporters/shared", "node/artifacts.js"];
          const problems = modules => modules.filter(path => {
            const relative = path.split("/eval/dist/")[1];
            if (relative) return /^(?:runner|dataset|node|comparison|calibration|grounding|conversion|reporters|docture|judge|adapters)\//.test(relative) && !allowed.some(area => (relative === area || relative.startsWith(area + "/")));
            return /\/docture\/dist\/(?!core\/)|\/node_modules\/(?:ai|pdfjs-dist|mupdf|tesseract\.js)\//.test(path);
          });
          const clean = await buildEvalRootBundle(consumer, bundler, tools, save, subpath);
          assert.deepEqual(problems(clean.modules), []);
          await run(`${bundler}-eval-${subpath.replaceAll("/", "-")}`, "node", [clean.output], consumer);
          const mutated = await buildEvalRootBundle(mutation, bundler, tools, save, subpath);
          assert.ok(problems(mutated.modules).some(path => path.includes("judge/boundary-control")));
        });
      } finally { await save(destination, original); }
    }
    for (const bundler of ["esbuild", "rollup"]) {
      await check(`${bundler} eval root production bundle excludes non-root capabilities`, async () => {
        const evidence = await buildEvalRootBundle(consumer, bundler, tools, save);
        assert.deepEqual(evalRootProblems(evidence.modules), []);
        assert.ok(evidence.modules.some(path => /\/eval\/dist\//.test(path)), "eval implementation contributes");
        await run(`${bundler}-eval-bundle`, "node", [evidence.output], consumer);
      });
      await check(`${bundler} eval root mutation detects a retained judge implementation`, async () => {
        const evidence = await buildEvalRootBundle(mutation, bundler, tools, save);
        assert.ok(evalRootProblems(evidence.modules).some(path => path.includes("judge/boundary-control")), "the isolation check rejects a widened root graph");
      });
    }
  }
}

function evalRootProblems(modules) {
  return modules.filter(path => /\/eval\/dist\/(?:dataset|runner|node|comparison|calibration|grounding|conversion|reporters|docture|judge|adapters)\//.test(path) ||
    /\/docture\/dist\/(?!core\/)/.test(path) || /\/node_modules\/(?:ai|pdfjs-dist|mupdf|tesseract\.js|ppu-paddle-ocr|onnxruntime-node|@napi-rs\/canvas)\//.test(path));
}

async function buildEvalRootBundle(consumer, bundler, tools, save, subpath = ".") {
  const suffix = subpath.replaceAll(/[^a-z]/g, "-");
  const nodeReporter = subpath.startsWith("./reporters/");
  const externalAllowed = path => nodeReporter && path.startsWith("node:");
  const entry = join(consumer, `eval-${suffix}-consumer.mjs`);
  const output = join(consumer, `eval-${suffix}-${bundler}.mjs`);
  await save(entry, `export * as api from "@docture/eval${subpath === '.' ? '' : subpath.slice(1)}";`);
  let modules;
  if (bundler === "esbuild") {
    const result = await tools.esbuild.build({ entryPoints: [entry], absWorkingDir: consumer, outfile: output, bundle: true, platform: nodeReporter ? "node" : "browser", format: "esm", minify: true, treeShaking: true, metafile: true, define: { "process.env.NODE_ENV": '"production"' } });
    assert.deepEqual(Object.values(result.metafile.outputs).flatMap(item => item.imports).filter(item => !externalAllowed(item.path)), []);
    modules = Object.values(result.metafile.outputs).flatMap(item => Object.entries(item.inputs).filter(([, info]) => info.bytesInOutput > 0).map(([path]) => join(consumer, path).replaceAll("\\", "/")));
    await save(join(consumer, `eval-${suffix}-esbuild-metafile.json`), result.metafile);
  } else {
    const build = await tools.rollup.rollup({ input: entry, treeshake: true, plugins: [tools.resolve.nodeResolve({ browser: !nodeReporter, preferBuiltins: true, exportConditions: [nodeReporter ? "node" : "browser", "production"] }), tools.commonjs.default()], onwarn(warning) { if (["UNRESOLVED_IMPORT", "MISSING_EXPORT"].includes(warning.code)) throw new Error(warning.message); } });
    try {
      const result = await build.write({ file: output, format: "esm", inlineDynamicImports: true, plugins: [tools.terser.default({ module: true, maxWorkers: 1 })] });
      const chunks = result.output.filter(item => item.type === "chunk");
      assert.deepEqual(chunks.flatMap(item => [...item.imports, ...item.dynamicImports]).filter(path => !externalAllowed(path)), []);
      modules = chunks.flatMap(item => Object.entries(item.modules).filter(([, info]) => info.renderedLength > 0).map(([path]) => path.replaceAll("\\", "/")));
    } finally { await build.close(); }
  }
  await save(join(consumer, `eval-${suffix}-${bundler}-contributions.json`), modules);
  return { modules, output };
}

const evalOfflineRuntime = String.raw`
import assert from "node:assert/strict";
import { buildResult, looseEval } from "@docture/eval";
import { renderHtml } from "@docture/eval/reporters/html";
const spec = looseEval();
const result = buildResult({ run: { id: "offline", status: "complete", startedAt: "2026-01-01T00:00:00Z", dataset: { id: "fixture", size: 1, fingerprint: "fixture" }, spec: spec.info, experiments: [{ id: "echo", configHash: "echo" }], epochs: 1 }, cases: [{ outcome: "scored", caseId: "one", experiment: "echo", epoch: 0, tags: {}, startedAt: "2026-01-01T00:00:00Z", ms: 1, expected: { n: 1 }, actual: { n: 1 }, score: spec.score({ n: 1 }, { n: 1 }) }] });
const html = renderHtml(result);
assert.ok(html.includes("offline"));
assert.ok(html.includes("<script"));
assert.equal(/(?:src|href)\s*=\s*["'](?:https?:|\/\/)|url\(\s*["']?(?:https?:|\/\/)/i.test(html), false);
`;
