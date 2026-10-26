import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { setImmediate } from "node:timers/promises";

const [root, engine] = process.argv.slice(2);
registerHooks({
  load(url, context, next) {
    if (/\/loaders\/tesseract\/tesseract\.(ts|js)$/.test(url)) {
      return { format: "module", shortCircuit: true, source: "export class TesseractPool { async recognize(){ return {words:[],confidence:1}; } async terminate(){} }" };
    }
    if (/\/loaders\/paddleocr\/paddle\.(ts|js)$/.test(url)) {
      return { format: "module", shortCircuit: true, source: "export class PaddleEngine { async recognizeAll(images){ return images.map(()=>({regions:[],confidence:1})); } async destroy(){} }" };
    }
    return next(url, context);
  },
});
const file = root + "/packages/docture/src/loaders/" + engine + "/loader.ts";
const module = await import(pathToFileURL(file).href);
const Loader = Object.values(module).find((value) => typeof value === "function" && typeof value.prototype?.load === "function");
const refs = [];
let calls = 0;
const rasterizer = {
  name: "tracked", formats: ["png"],
  async rasterize(_raw, options) {
    calls++;
    return (options?.pages ?? [1, 2, 3]).map((pageNumber) => {
      const bytes = new Uint8Array(8 * 1024 * 1024);
      if (calls === 1) refs.push(new WeakRef(bytes));
      return {pageNumber,bytes,widthPx:1,heightPx:1,scale:1,format:"png"};
    });
  },
};
const logger = {debug(){},info(){},warn(){},error(){},child(){return this;}};
const loader = new Loader({rasterizer});
const document = await loader.load({bytes:new Uint8Array([37,80,68,70]),mimeType:"application/pdf"},{signal:new AbortController().signal,logger});
for (let turn = 0; turn < 12; turn++) { await setImmediate(); global.gc(); }
const retained = refs.filter((ref) => ref.deref() !== undefined).length;
assert.equal(retained, 0, "OCR raster buffers remain retained while the document is held");
assert.deepEqual(document.pages.map((page) => page.pageNumber), [1,2,3]);
await document.pages[1].image();
await document.pages[1].image();
assert.equal(calls, 2);
await loader.dispose();
console.log(JSON.stringify({retained,calls,pages:document.pages.length}));
