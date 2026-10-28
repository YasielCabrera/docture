import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

test("portable root and chunks bundle and run without Node globals", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { contents: `import * as core from "./packages/docture/src/index.ts"; import * as chunk from "./packages/docture/src/chunk/index.ts"; globalThis.api = { ...core, ...chunk };`, resolveDir: root },
    bundle: true, platform: "browser", conditions: ["browser"], format: "iife", minify: true, write: false, metafile: true,
  });
  assert.ok(Object.keys(bundle.metafile.inputs).length > 1);
  assert.deepEqual(Object.values(bundle.metafile.inputs).flatMap((input) => input.imports).filter((entry) => entry.path.startsWith("node:")), []);
  const context = { TextEncoder, TextDecoder, URL, AbortController, performance, fetch, setTimeout, clearTimeout, console };
  runInNewContext(bundle.outputFiles[0].text, context);
  const result = await runInNewContext(`(async () => {
    const { resolveSource, DocumentConverter, chunkDocument, errorCodeOf } = api;
    const bytes = new Uint8Array([65,66,67]);
    const forms = [bytes, bytes.buffer, {bytes, mimeType:"text/plain"}];
    const resolved = await Promise.all(forms.map(value => resolveSource(value)));
    const unsupported = await Promise.all(["local.txt", new URL("file:///tmp/local.txt")].map(value => resolveSource(value).catch(error => errorCodeOf(error))));
    const loaded = { loaded: { loader:"portable-fixture", form:"digital", text:"Portable text", pages:[{pageNumber:1,width:100,height:100,text:"Portable text",lines:[],blocks:[{id:"figure",kind:"image",assetId:"asset",x:1,y:2,width:3,height:4,alt:"pixel"}],assets:[{id:"asset",pageNumber:1,name:"pixel.png",mimeType:"image/png",bytes,x:1,y:2,width:3,height:4}]}] }};
    const converter = new DocumentConverter();
    const conversions = [];
    for (const format of ["json","markdown","html","text"]) for (const assets of ["embedded","referenced","omit"]) {
      const result = await converter.convert(loaded, {format,assets});
      conversions.push({format,assets,content:result.content});
    }
    const document = await converter.convert(loaded, {format:"json",assets:"embedded"});
    const chunks = chunkDocument(document, {budget:{unit:"characters",max:200}});
    return JSON.stringify({types:resolved.map(value=>value.mimeType),unsupported,conversions,chunkIds:chunks.map(value=>value.id)});
  })()`, context);
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed.types, ["application/octet-stream", "application/octet-stream", "text/plain"]);
  assert.deepEqual(parsed.unsupported, ["UNSUPPORTED_SOURCE", "UNSUPPORTED_SOURCE"]);
  assert.match(parsed.conversions.find((item) => item.format === "json" && item.assets === "embedded").content, /"data":\s*"QUJD"/);
  assert.match(parsed.conversions.find((item) => item.format === "markdown" && item.assets === "embedded").content, /base64,QUJD/);
  assert.equal(parsed.conversions.length, 12);
  assert.ok(parsed.chunkIds.every((id) => /^chunk-[0-9a-f]{16}$/.test(id)));
});
