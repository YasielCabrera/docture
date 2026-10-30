import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const [root] = process.argv.slice(2);
let attempts = 0;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "vitest" || specifier.startsWith("vitest/")) {
      attempts++;
      throw Object.assign(Error("Vitest intentionally unavailable"), {code:"ERR_MODULE_NOT_FOUND"});
    }
    return next(specifier, context);
  },
});
const manifest = JSON.parse(readFileSync(root + "/packages/docture/package.json","utf8"));
assert.equal(manifest.exports["./testing"],undefined);
for (const name of ["doubles","fixtures","conformance"]) assert.ok(manifest.exports["./testing/"+name]);
const doubles = await import(pathToFileURL(root + "/packages/docture/src/testing/doubles.ts").href);
const fixtures = await import(pathToFileURL(root + "/packages/docture/src/testing/fixtures/index.ts").href);
assert.equal(doubles.loadedDocument(["literal text"]).text,"literal text");
assert.equal(typeof fixtures.makeInvoicePdf,"function");
assert.equal(attempts,0);
const failure = await import(pathToFileURL(root + "/packages/docture/src/testing/conformance/index.ts").href).then(()=>null,(error)=>error.code);
assert.equal(failure,"ERR_MODULE_NOT_FOUND");
assert.ok(attempts > 0);
console.log(JSON.stringify({text:"literal text",fixture:true,isolated:true}));
