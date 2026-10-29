import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";

// Synthetic-only engines stay exact pins: floor equals current until a release beside the pin passes.
export const syntheticEngineMatrix = {
  floor: { sharp: "0.35.5", "@faker-js/faker": "10.6.0", "playwright-core": "1.64.1" },
  current: { sharp: "0.35.5", "@faker-js/faker": "10.6.0", "playwright-core": "1.64.1" },
};
const sharedEngines = ["pdfkit", "pdfjs-dist", "@napi-rs/canvas", "ai"];
const syntheticOnlyEngines = Object.keys(syntheticEngineMatrix.floor);
const engineTypedEntries = { "./faker": "@faker-js/faker", "./llm": "ai", "./html": "playwright-core" };
const mainExports = {
  ".": "defineModel", "./pdfkit": "renderPdf", "./verify": "verifyLabels", "./measure": "compareLayouts", "./degrade": "degrade",
  "./faker": "fakerFor", "./llm": "llmTextPool", "./html": "renderHtmlPdf", "./node": "writeCorpus",
};
const tscArgs = file => ["--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", file];
const specifier = key => key === "." ? "@docture/synthetic" : `@docture/synthetic/${key.slice(2)}`;

export async function verifySyntheticPackage({ packed, tools, check, newConsumer, install, save, run, tsc, versionSpec, assertInstalled, installedPackages }) {
  const manifest = packed["@docture/synthetic"].manifest;
  const tarballs = [packed.docture.target, packed["@docture/synthetic"].target];
  const absent = async (consumer, label) => {
    const names = new Set((await installedPackages(consumer)).map(pkg => pkg.name));
    for (const name of syntheticOnlyEngines) assert.equal(names.has(name), false, `${label}: ${name} must not install by default`);
  };

  await check("synthetic engine peers are exact pins or docture's verified ranges", async () => {
    const peers = manifest.peerDependencies;
    assert.equal(peers.docture, `^${packed.docture.manifest.version}`, "synthetic peers on the packed docture release");
    assert.deepEqual(Object.keys(syntheticEngineMatrix.current).sort(), Object.keys(syntheticEngineMatrix.floor).sort());
    for (const [name, floor] of Object.entries(syntheticEngineMatrix.floor)) {
      if (syntheticEngineMatrix.current[name] === floor) assert.equal(peers[name], floor, `${name} stays an exact pin until the matrix verifies a newer release`);
      else assert.equal(/\d+\.\d+\.\d+/.exec(peers[name])?.[0], floor, `${name} range starts at its tested floor`);
    }
    for (const name of sharedEngines) assert.equal(peers[name], packed.docture.manifest.peerDependencies[name], `synthetic reuses docture's verified ${name} range`);
    const engines = Object.keys(peers).filter(name => name !== "docture");
    assert.deepEqual(engines.filter(name => !sharedEngines.includes(name) && !syntheticOnlyEngines.includes(name)), [], "every synthetic engine has a verification policy");
    for (const name of engines) assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} is an optional synthetic peer`);
  });

  let engineFree;
  for (const manager of ["npm", "pnpm"]) {
    const consumer = await newConsumer(`${manager}-synthetic-engine-free`);
    if (manager === "npm") engineFree = consumer;
    await check(`${manager} every packed synthetic entry loads, names each missing engine and keeps error identity without engines`, async () => {
      await install(consumer, manager, "synthetic-engine-free", [...tarballs, versionSpec("@types/node")]);
      await assertInstalled(consumer, "synthetic-engine-free", []);
      await absent(consumer, "synthetic-engine-free");
      await save(join(consumer, "synthetic-entries.mjs"), syntheticEntryRuntime(manifest));
      await run(`${manager}-synthetic-entries`, "node", ["synthetic-entries.mjs"], consumer);
      await save(join(consumer, "synthetic-types.ts"), syntheticTypes(manifest.exports));
      await run(`${manager}-synthetic-types`, tsc, tscArgs("synthetic-types.ts"), consumer);
      await save(join(consumer, "synthetic-missing.mjs"), syntheticMissingEngineRuntime);
      await run(`${manager}-synthetic-missing-engines`, "node", ["synthetic-missing.mjs"], consumer);
      await save(join(consumer, "synthetic-identity.mjs"), syntheticIdentityRuntime);
      await run(`${manager}-synthetic-identity`, "node", ["synthetic-identity.mjs"], consumer);
    });
  }

  if (engineFree !== undefined) {
    const mutation = await newConsumer("synthetic-root-mutation");
    await mkdir(join(mutation, "node_modules"), { recursive: true });
    for (const item of await readdir(join(engineFree, "node_modules"))) {
      if (item !== "@docture") await symlink(join(engineFree, "node_modules", item), join(mutation, "node_modules", item), "dir");
    }
    const library = join(mutation, "node_modules/@docture/synthetic");
    await cp(join(engineFree, "node_modules/@docture/synthetic"), library, { recursive: true, dereference: true });
    const target = join(library, manifest.exports["."].import);
    await save(target, await readFile(target, "utf8") + '\nexport { renderPdf as retainedRenderer } from "./pdfkit/index.js";\n');
    await check("esbuild synthetic root production bundle includes no entry folder or engine", async () => {
      const evidence = await buildSyntheticRootBundle(engineFree, tools, save);
      assert.deepEqual(evidence.external, [], "the portable root bundles with no external or Node built-in import");
      assert.deepEqual(syntheticRootProblems(evidence.modules), []);
      assert.ok(evidence.modules.some(path => /\/synthetic\/dist\/model\.js$/.test(path)), "the synthetic model contributes");
      await run("esbuild-synthetic-bundle", "node", [evidence.output], engineFree);
    });
    await check("esbuild synthetic root mutation detects a retained renderer", async () => {
      const evidence = await buildSyntheticRootBundle(mutation, tools, save);
      assert.ok(syntheticRootProblems(evidence.modules).some(path => path.endsWith("/synthetic/dist/pdfkit/renderer.js")), "the isolation check rejects a widened root graph");
    });
  }

  await check("npm packed synthetic pdfkit entry renders a labeled invoice with only pdfkit installed", async () => {
    const consumer = await newConsumer("npm-synthetic-pdfkit");
    await install(consumer, "npm", "synthetic-pdfkit", [...tarballs, versionSpec("pdfkit"), versionSpec("@types/node")], { strictPeers: true });
    await assertInstalled(consumer, "synthetic-pdfkit", ["pdfkit"]);
    await absent(consumer, "synthetic-pdfkit");
    await save(join(consumer, "synthetic-invoice.mjs"), syntheticInvoiceRuntime);
    await run("npm-synthetic-invoice", "node", ["synthetic-invoice.mjs"], consumer);
  });

  const tiers = Object.entries(syntheticEngineMatrix).filter(([, versions], index, all) =>
    all.findIndex(([, other]) => JSON.stringify(other) === JSON.stringify(versions)) === index);
  for (const manager of ["npm", "pnpm"]) for (const [tier, versions] of tiers) {
    await check(`${manager} synthetic ${tier} engines render, verify, degrade, generate and write a corpus eval reads`, async () => {
      const label = `${manager}-synthetic-engines-${tier}`;
      const consumer = await newConsumer(label);
      await install(consumer, manager, label, [
        ...tarballs, packed["@docture/eval"].target, ...Object.entries(versions).map(([name, version]) => `${name}@${version}`),
        ...["pdfkit", "pdfjs-dist", "@napi-rs/canvas", "ai", "zod", "@types/node"].map(versionSpec),
      ], { strictPeers: true });
      await assertInstalled(consumer, label, ["pdfkit", "pdfjs-dist", "@napi-rs/canvas", "ai"]);
      const installed = await installedPackages(consumer);
      for (const [name, version] of Object.entries(versions)) {
        assert.deepEqual(installed.filter(pkg => pkg.name === name).map(pkg => pkg.version), [version], `${tier} installs ${name}@${version} once`);
      }
      await save(join(consumer, "synthetic-engines.mjs"), syntheticEnginesRuntime);
      await run(`${label}-runtime`, "node", ["synthetic-engines.mjs"], consumer);
      await save(join(consumer, "synthetic-engine-types.ts"), syntheticEngineTypes);
      await run(`${label}-types`, tsc, tscArgs("synthetic-engine-types.ts"), consumer);
      return { versions };
    });
  }
}

function syntheticRootProblems(modules) {
  return modules.filter(path => /\/synthetic\/dist\/(?:pdfkit|verify|measure|degrade|faker|llm|html|node)\//.test(path) ||
    /\/docture\/dist\/(?!core\/)/.test(path) ||
    /\/node_modules\/(?:pdfkit|pdfjs-dist|@napi-rs\/canvas|sharp|@img|@faker-js\/faker|playwright-core|ai|mupdf|tesseract\.js)\//.test(path));
}

async function buildSyntheticRootBundle(consumer, tools, save) {
  const entry = join(consumer, "synthetic-root-consumer.mjs");
  const output = join(consumer, "synthetic-root-esbuild.mjs");
  await save(entry, `import * as api from "@docture/synthetic";
const model = api.defineModel({ type: "object", properties: { n: { type: "integer" } }, required: ["n"] }, { fields: { n: api.gen.int(1, 9) } });
const sample = await model.sample({ seed: 1 });
if (!(sample.value.n >= 1 && sample.value.n <= 9)) throw new Error("bundled model sampled " + JSON.stringify(sample.value));
export { api };`);
  const result = await tools.esbuild.build({
    entryPoints: [entry], absWorkingDir: consumer, outfile: output, bundle: true, platform: "browser", format: "esm",
    minify: true, treeShaking: true, metafile: true, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  const external = Object.values(result.metafile.outputs).flatMap(item => item.imports.map(value => value.path));
  const modules = Object.values(result.metafile.outputs).flatMap(item => Object.entries(item.inputs)
    .filter(([, info]) => info.bytesInOutput > 0).map(([path]) => join(consumer, path).replaceAll("\\", "/")));
  await save(join(consumer, "synthetic-root-esbuild-metafile.json"), result.metafile);
  return { modules, external, output };
}

function syntheticEntryRuntime(manifest) {
  return `import assert from "node:assert/strict";
const peers = ${JSON.stringify(manifest.peerDependencies)};
${Object.keys(manifest.exports).map(key => `{
  const entry = await import(${JSON.stringify(specifier(key))});
  assert.ok(Object.keys(entry).length > 0, ${JSON.stringify(specifier(key))});
  for (const [engine, range] of Object.entries(entry.ENGINE_RANGES ?? {})) assert.equal(range, peers[engine], ${JSON.stringify(specifier(key))} + " ENGINE_RANGES." + engine + " equals the declared peer");
}`).join("\n")}
console.log("every packed synthetic export loads without optional engines");`;
}

function syntheticTypes(exports) {
  return Object.keys(exports).filter(key => !(key in engineTypedEntries)).map((key, index) => {
    if (!mainExports[key]) throw new Error(`Declare the main consumer export for ${key}`);
    return `import { ${mainExports[key]} as entry${index} } from ${JSON.stringify(specifier(key))};\nvoid entry${index};`;
  }).join("\n");
}

const invoiceModule = String.raw`
import { defineModel, defineTemplate, gen, locales, toEvalCase } from "@docture/synthetic";
export const schema = {
  type: "object", additionalProperties: false, required: ["invoiceNumber", "seller", "totalCents"],
  properties: { invoiceNumber: { type: "string" }, seller: { type: "string" }, totalCents: { type: "integer" } },
};
export const model = defineModel(schema, { fields: { invoiceNumber: gen.pattern("INV-######"), seller: gen.pick(["Kestrel Labs", "Atlas Office Supply"]), totalCents: gen.int(100, 99999) } });
export const template = defineTemplate()({
  key: "packed", family: "invoice", locale: locales["de-DE"],
  printed: { invoiceNumber: true, seller: true, totalCents: true },
  draw(page, value, f) {
    page.text("RECHNUNG", { x: 50, y: 50, size: 20, font: "bold" });
    page.field("seller", value.seller, { x: 50, y: 90, size: 11 });
    page.field("invoiceNumber", value.invoiceNumber, { x: 50, y: 110, size: 11 });
    page.field("totalCents", f.money(value.totalCents), { x: 400, y: 110, size: 11 });
  },
});
export { toEvalCase };
`;

const syntheticInvoiceRuntime = String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
${invoiceModule}
import { renderPdf } from "@docture/synthetic/pdfkit";
const sample = await model.sample({ seed: 7 });
const doc = await renderPdf(template, sample);
assert.equal(new TextDecoder().decode(doc.bytes.slice(0, 5)), "%PDF-");
assert.deepEqual(doc.pages, [{ pageNumber: 1, width: 595.28, height: 841.89 }]);
assert.deepEqual(doc.labels.map(label => label.path), ["seller", "invoiceNumber", "totalCents"]);
const number = doc.labels.find(label => label.path === "invoiceNumber");
assert.equal(number.text, sample.value.invoiceNumber);
assert.match(number.text, /^INV-\d{6}$/);
assert.deepEqual([number.pageNumber, number.box.x, number.box.y], [1, 50, 110]);
assert.match(doc.labels.find(label => label.path === "totalCents").text, /^[\d.]+,\d\d €$/u);
assert.deepEqual(doc.expected, sample.value);
const evalCase = toEvalCase(doc);
assert.equal(evalCase.id, "packed-base-7-digital");
assert.deepEqual(evalCase.locations.invoiceNumber, [{ pageNumber: 1, box: number.box }]);
const again = await renderPdf(template, await model.sample({ seed: 7 }));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(again.bytes), sha(doc.bytes), "equal seeds render equal bytes");
`;

const syntheticMissingEngineRuntime = String.raw`
import assert from "node:assert/strict";
import { MissingEngineError } from "docture";
${invoiceModule}
import { renderPdf } from "@docture/synthetic/pdfkit";
import { measurePdf } from "@docture/synthetic/measure";
import { degrade } from "@docture/synthetic/degrade";
import { fakerFor } from "@docture/synthetic/faker";
import { renderHtmlPdf, defineHtmlTemplate } from "@docture/synthetic/html";
import { llmTextPool } from "@docture/synthetic/llm";
const missing = (engine, entry) => error => {
  assert.ok(error instanceof MissingEngineError, String(error?.stack ?? error));
  assert.equal(error.engine, engine);
  assert.ok(error.message.includes(entry), error.message);
  return true;
};
const sample = await model.sample({ seed: 1 });
await assert.rejects(renderPdf(template, sample), missing("pdfkit", "@docture/synthetic/pdfkit"));
const document = {
  bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", pages: [{ pageNumber: 1, width: 595.28, height: 841.89 }],
  expected: sample.value, labels: [], sample: { seed: 1, scenario: "base", tags: [] },
  template: { key: "packed", family: "invoice", tags: {} }, rendition: { kind: "digital" }, provenance: {},
};
await assert.rejects(degrade(document, { profile: "scan", severity: 0.5 }), missing("sharp", "@docture/synthetic/degrade"));
await assert.rejects(measurePdf(document.bytes), missing("pdfjs-dist", "docture/loaders/pdfjs"));
await assert.rejects(fakerFor("de"), missing("@faker-js/faker", "@docture/synthetic/faker"));
const html = defineHtmlTemplate()({
  key: "packed-html", family: "invoice", locale: locales["de-DE"], printed: { invoiceNumber: true, seller: true, totalCents: true },
  render: value => '<section class="page"><p data-field="invoiceNumber">' + value.invoiceNumber + "</p></section>",
});
await assert.rejects(renderHtmlPdf(html, sample), missing("playwright-core", "@docture/synthetic/html"));
await assert.rejects(llmTextPool({ model: "openai/gpt-5", prompt: "German trade names", count: 3 }), missing("ai", "@docture/synthetic/llm"));
console.log("every synthetic engine entry names its missing engine");
`;

const syntheticIdentityRuntime = String.raw`
import assert from "node:assert/strict";
import { cp, rm, mkdir, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DoctureError } from "docture";
import { LabelVerificationError, SynthesisError, TemplateError } from "@docture/synthetic";
await mkdir("foreign/node_modules/@docture", { recursive: true });
await writeFile("foreign/package.json", JSON.stringify({ private: true, type: "module" }));
const dependencies = dirname(await realpath("node_modules/docture"));
for (const item of await readdir(dependencies)) {
  if (item === "docture" || item === "@docture" || item.startsWith(".")) continue;
  await symlink(join(dependencies, item), join("foreign/node_modules", item), "dir");
}
await cp("node_modules/docture", "foreign/node_modules/docture", { recursive: true, dereference: true });
await cp("node_modules/@docture/synthetic", "foreign/node_modules/@docture/synthetic", { recursive: true, dereference: true });
try {
  const { DoctureError: ForeignBase } = await import("./foreign/node_modules/docture/dist/index.js");
  const foreign = await import("./foreign/node_modules/@docture/synthetic/dist/index.js");
  assert.notEqual(ForeignBase, DoctureError);
  assert.notEqual(foreign.SynthesisError, SynthesisError);
  const error = new foreign.SynthesisError([{ path: "totalCents", message: "no value satisfies sum" }]);
  assert.ok(error instanceof SynthesisError);
  assert.ok(error instanceof DoctureError);
  assert.equal(error instanceof TemplateError, false);
  assert.equal(error.code, "SYNTHESIS_FAILED");
  assert.equal(error.message, "Synthesis failed:\n  - totalCents: no value satisfies sum");
  assert.equal(Object.hasOwn(foreign.SynthesisError, "doctureErrorIdentity"), true);
  assert.equal({ name: error.name, code: error.code } instanceof SynthesisError, false);
  assert.ok(new foreign.TemplateError("packed", []) instanceof TemplateError);
  assert.ok(new foreign.LabelVerificationError([]) instanceof LabelVerificationError);
  assert.ok(new SynthesisError([]) instanceof foreign.SynthesisError);
} finally { await rm("foreign", { recursive: true, force: true }); }
`;

const syntheticEnginesRuntime = String.raw`
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
${invoiceModule}
import { defineModel as define } from "@docture/synthetic";
import { renderPdf } from "@docture/synthetic/pdfkit";
import { verifyLabels } from "@docture/synthetic/verify";
import { compareLayouts } from "@docture/synthetic/measure";
import { degrade } from "@docture/synthetic/degrade";
import { fakerFor } from "@docture/synthetic/faker";
import { renderHtmlPdf, defineHtmlTemplate } from "@docture/synthetic/html";
import { digital, writeCorpus } from "@docture/synthetic/node";
import { jsonlDataset } from "@docture/eval/node";

const sample = await model.sample({ seed: 3 });
const doc = await renderPdf(template, sample);
const report = await verifyLabels(doc);
assert.deepEqual(report.failures, [], "every label is found inside its box on the rendered page");
const drift = await compareLayouts(doc.bytes, await renderPdf(template, sample));
assert.deepEqual([drift.ok, drift.maxDrift, drift.matched.map(line => line.text)], [true, 0, ["RECHNUNG", sample.value.seller, sample.value.invoiceNumber, doc.labels[2].text]], "a re-render matches its reference line for line");

const scanned = await degrade(doc, { profile: "scan", severity: 0.5, dpi: 100 });
assert.equal(scanned.mimeType, "application/pdf");
assert.equal(new TextDecoder().decode(scanned.bytes.slice(0, 5)), "%PDF-");
assert.deepEqual(scanned.rendition, { kind: "scan", severity: 0.5, dpi: 100 });
assert.deepEqual(scanned.labels.map(label => label.path), doc.labels.map(label => label.path));
assert.deepEqual(scanned.expected, doc.expected);

const fake = await fakerFor("de");
const people = define({ type: "object", required: ["name"], properties: { name: { type: "string" } } }, { fields: { name: fake(faker => faker.person.fullName()) } });
const first = await people.sample({ seed: 9 });
assert.equal(typeof first.value.name, "string");
assert.ok(first.value.name.length > 2, first.value.name);
assert.deepEqual((await people.sample({ seed: 9 })).value, first.value, "faker values depend only on the seed");

const html = defineHtmlTemplate()({
  key: "packed-html", family: "invoice", locale: locales["de-DE"], printed: { invoiceNumber: true, seller: true, totalCents: true },
  render: value => '<section class="page"><p data-field="invoiceNumber">' + value.invoiceNumber + "</p></section>",
});
await assert.rejects(renderHtmlPdf(html, sample, { executablePath: "/nonexistent/docture-chromium" }), error => String(error?.message).includes("/nonexistent/docture-chromium"));

const directory = await mkdtemp(join(tmpdir(), "docture-synthetic-corpus-"));
try {
  const written = await writeCorpus(directory, { model, templates: [template], seeds: [1, 2], renditions: [digital()] });
  assert.deepEqual([written.written, written.skipped, written.failed], [2, 0, []]);
  const cases = await jsonlDataset(written.manifest).cases();
  assert.deepEqual(cases.map(item => item.id).sort(), ["packed-base-1-digital", "packed-base-2-digital"]);
  for (const item of cases) {
    assert.deepEqual(Object.keys(item.locations).sort(), ["invoiceNumber", "seller", "totalCents"]);
    assert.equal(item.locations.invoiceNumber[0].pageNumber, 1);
    assert.deepEqual([item.locations.invoiceNumber[0].box.x, item.locations.invoiceNumber[0].box.y], [50, 110]);
    assert.match(String(item.expected.invoiceNumber), /^INV-\d{6}$/);
  }
  const rerun = await writeCorpus(directory, { model, templates: [template], seeds: [1, 2], renditions: [digital()] });
  assert.deepEqual([rerun.written, rerun.skipped], [0, 2], "rewriting an unchanged corpus skips every case");
  assert.equal(await readFile(written.manifest, "utf8"), await readFile(rerun.manifest, "utf8"));
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("packed synthetic engines render, verify, degrade, generate and write an eval corpus");
`;

const syntheticEngineTypes = String.raw`
import type { LanguageModel } from "ai";
import type { Faker } from "@faker-js/faker";
import type { Browser } from "playwright-core";
import { defineModel, typedJsonSchema, type Generator } from "@docture/synthetic";
import { fakerFor } from "@docture/synthetic/faker";
import { llmTextPool, type TextPoolOptions } from "@docture/synthetic/llm";
import { renderHtmlPdf, type RenderHtmlPdfOptions } from "@docture/synthetic/html";
declare const model: LanguageModel;
declare const browser: Browser;
const pool: Promise<readonly string[]> = llmTextPool({ model, prompt: "German trade names", count: 3 } satisfies TextPoolOptions);
const options: RenderHtmlPdfOptions = { browser };
const fake = await fakerFor("de");
const name: Generator<string> = fake((faker: Faker) => faker.person.fullName());
const people = defineModel(typedJsonSchema<{ name: string }>({ type: "object", required: ["name"], properties: { name: { type: "string" } } }), { fields: { name } });
void pool; void options; void people; void renderHtmlPdf;
`;
