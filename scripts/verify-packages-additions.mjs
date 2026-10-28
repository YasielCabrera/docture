import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import { calibrateFields } from "docture/eval";
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
assert.equal(calibrateFields([],{targetPrecision:.99}).experimental,true);
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
import { calibrateFields } from "docture/eval";
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
void evidence;void tools;void importDoclingDocument;void PaperlessSource;void calibrateFields;
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
  for (const [label, specifier, allowed] of [
    ["paperless-read", "docture/sources/paperless", /^(core|paperless|sources\/paperless)\//],
    ["docling-import", "docture/import/docling", /^(core|import\/docling)\//],
    ["docling-service", "docture/loaders/docling", /^(core|import\/docling|loaders\/docling)\//],
    ["azure-read", "docture/loaders/azure-di", /^(core|loaders\/azure-di)\//],
    ["extraction-tool", "docture/llm/tool", /^(core|llm\/tool)/],
  ]) {
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
