import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const roleCases = [
  ["an AI SDK import in an engine-free helper", "llm/merge.ts", 'import { generateText } from "ai";\nexport const leaked = generateText;', "llm/merge.ts imports undeclared boundary ai"],
  ["a Zod import in an engine-free helper", "llm/relax.ts", 'import { z } from "zod/v4";\nexport const leaked = z.string();', "llm/relax.ts imports undeclared boundary zod/v4"],
  ["an AI SDK type in an engine-free helper", "llm/prompt.ts", 'export type Leaked = import("ai").LanguageModel;', "llm/prompt.ts imports undeclared boundary ai"],
  ["a capability import in an engine-free helper", "llm/pricing.ts", 'export { llm as leaked } from "./strategy.js";', "llm/pricing.ts crosses into ./strategy.js"],
  ["one capability importing another", "llm/classifier.ts", 'export { TextSplitter as Leaked } from "./split.js";', "llm/classifier.ts crosses into ./split.js"],
  ["a capability importing the convenience class", "llm/vision.ts", 'export { LLM as Leaked } from "./llm.js";', "llm/vision.ts crosses into ./llm.js"],
  ["the text entry re-exporting the broad entry", "llm/text.ts", 'export * from "./index.js";', "llm/text.ts crosses into ./index.js"],
  ["a Zod import in a capability that declares none", "llm/vision.ts", 'import { z } from "zod/v4";\nexport const leaked = z.string();', "llm/vision.ts imports undeclared boundary zod/v4"],
  ["the extractor factory reaching a capability it does not compose", "llm/extractor.ts", 'export { TextSplitter as Leaked } from "./split.js";', "llm/extractor.ts crosses into ./split.js"],
];
const cases = [
  ["Node built-ins in portable core", 'import { createHash } from "node:crypto"; export const leaked = createHash;', "imports a Node built-in from a portable entry"],
  ["HTML parser imports outside their syntax boundary", 'import { parse } from "parse5"; export const leaked = parse;', "undeclared boundary parse5"],
  ["XML parser imports outside their syntax boundary", 'import { Parser } from "htmlparser2"; export const leaked = Parser;', "undeclared boundary htmlparser2"],
  ["entity decoder imports outside their syntax boundary", 'import { decodeHTMLStrict } from "entities"; export const leaked = decodeHTMLStrict;', "undeclared boundary entities"],
  ["static imports", 'import { generateText } from "ai";', "undeclared boundary ai"],
  ["re-exports", 'export { generateText } from "ai";', "undeclared boundary ai"],
  ["namespace re-exports", 'export * as ai from "ai";', "undeclared boundary ai"],
  ["type-only namespace re-exports", 'export type * as ai from "ai";', "undeclared boundary ai"],
  ["type imports", 'export type Model = import("ai").LanguageModel;', "undeclared boundary ai"],
  ["type reference directives", '/// <reference types="ai" preserve="true" />\nexport const value = 1;', "undeclared boundary ai"],
  ["cross-boundary path directives", '/// <reference path="../llm/strategy.ts" preserve="true" />\nexport const value = 1;', "crosses into ../llm/strategy.ts"],
  ["dynamic imports", 'export const load = () => import("ai");', "undeclared boundary ai"],
  ["literal-template imports", "export const load = () => import(`ai`);", "undeclared boundary ai"],
  ["require calls", 'export const load = () => require("ai");', "undeclared boundary ai"],
  ["require resolution", 'export const load = () => require.resolve("ai");', "undeclared boundary ai"],
  ["import-equals", 'import modules = require("node:module"); export const load = modules.createRequire(import.meta.url)("ai");', "node:module outside an engine asset resolver"],
  ["aliased module factories", 'import { createRequire as reader } from "node:module"; const load = reader(import.meta.url); export const model = load("ai");', "node:module outside an engine asset resolver"],
  ["namespace module factories", 'import * as modules from "node:module"; export const load = modules.createRequire(import.meta.url)("ai");', "node:module outside an engine asset resolver"],
  ["dynamic module factories", 'export const load = () => import("node:module");', "node:module outside an engine asset resolver"],
  ["imports from .mts sources", 'import { generateText } from "ai";', "undeclared boundary ai", ".mts"],
  ["namespace re-exports from .mts sources", 'export * as ai from "ai";', "undeclared boundary ai", ".mts"],
  ["namespace re-exports from .tsx sources", 'export * as ai from "ai";', "undeclared boundary ai", ".tsx"],
  ["CommonJS source files", "export const value = 1;", "CommonJS source .cts is not supported", ".cts"],
  ["unsupported syntax", "export const broken = ;", "cannot be parsed by the boundary checker"],
  ["computed imports", 'export const load = () => import(process.env.ENGINE);', "computed module specifier"],
];

test("runtime boundary checks reject every supported foreign import form", async t => {
  const directory = await mkdtemp(join(tmpdir(), "docture-boundaries-"));
  try {
    await mkdir(join(directory, "scripts"));
    await cp(join(root, "scripts/check-boundaries.mjs"), join(directory, "scripts/check-boundaries.mjs"));
    for (const name of ["docture", "cli", "eval"]) {
      const target = join(directory, "packages", name);
      await mkdir(target, { recursive: true });
      await cp(join(root, "packages", name, "package.json"), join(target, "package.json"));
      await cp(join(root, "packages", name, "src"), join(target, "src"), { recursive: true });
      if (name === "docture") {
        await cp(join(root, "packages/docture/tsconfig.test.json"), join(target, "tsconfig.test.json"));
      }
    }
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const probe = join(directory, "packages/docture/src/core/boundary-probe.ts");
    const check = () => spawnSync(process.execPath, [join(directory, "scripts/check-boundaries.mjs")], { encoding: "utf8" });
    const control = async () => {
      await writeFile(probe, 'export { sumUsage } from "./domain/result.js";\n');
      const result = check();
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    await t.test("permits core imports and existing engine asset resolvers", control);
    await t.test("permits statically known template imports within core", async () => {
      await writeFile(probe, 'export const load = () => import(`./domain/result.js`);');
      const result = check();
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
    await t.test("permits relative path directives within core", async () => {
      await writeFile(probe, '/// <reference path="domain/result.ts" preserve="true" />\nexport const value = 1;');
      const result = check();
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
    for (const [name, code, message, extension = ".ts"] of cases) {
      await t.test(`rejects ${name} in core`, async () => {
        const file = probe.replace(/\.ts$/, extension);
        try {
          await writeFile(file, code);
          const result = check();
          assert.notEqual(result.status, 0, `${name} must be rejected`);
          assert.ok(result.stderr.includes(message), result.stdout + result.stderr);
        } finally {
          await rm(file, { force: true });
        }
      });
    }
    const llm = join(directory, "packages/docture/src/llm");
    const withChange = async (file, code, action) => {
      const path = join(llm, file.slice("llm/".length));
      const original = await readFile(path, "utf8");
      try {
        await writeFile(path, `${original}\n${code}\n`);
        return action();
      } finally {
        await writeFile(path, original);
      }
    };
    for (const [name, file, code, message] of roleCases) {
      await t.test(`rejects ${name}`, () => withChange(file, code, () => {
        const result = check();
        assert.notEqual(result.status, 0, `${name} must be rejected`);
        assert.ok(result.stderr.includes(message), result.stdout + result.stderr);
      }));
    }
    await t.test("permits a capability to use helpers and shared modules", () => withChange(
      "llm/split.ts",
      'export { mergePartials as mergedAgain } from "./merge.js";\nexport { modelIdOf as idAgain } from "./model-id.js";',
      () => {
        const result = check();
        assert.equal(result.status, 0, result.stdout + result.stderr);
      },
    ));
    await t.test("permits installed schema-helper types in an engine-free LLM helper", () => withChange(
      "llm/cache.ts",
      'export type ProviderConfiguration = import("@ai-sdk/provider-utils").ProviderOptions;',
      () => {
        const result = check();
        assert.equal(result.status, 0, result.stdout + result.stderr);
      },
    ));
    await t.test("permits the convenience entry to combine capabilities", () => withChange(
      "llm/llm.ts",
      'export { TextSplitter as SplitterAgain } from "./split.js";\nexport { llmLayout as layoutAgain } from "./layout.js";',
      () => {
        const result = check();
        assert.equal(result.status, 0, result.stdout + result.stderr);
      },
    ));
    await t.test("rejects an LLM module without a declared role", async () => {
      const path = join(llm, "unowned.ts");
      try {
        await writeFile(path, "export const value = 1;\n");
        const result = check();
        assert.notEqual(result.status, 0, "an unassigned LLM module must be rejected");
        assert.ok(result.stderr.includes("llm/unowned.ts has no LLM module role"), result.stdout + result.stderr);
      } finally {
        await rm(path, { force: true });
      }
    });
    const cli = join(directory, "packages/cli/src");
    const cliCases = [
      ["a static MCP SDK import in the CLI", "run.ts", 'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nexport const leaked = McpServer;', "cli/run.ts statically imports the optional peer @modelcontextprotocol/sdk/server/mcp.js"],
      ["a lazy MCP SDK import outside src/mcp", "run.ts", 'export const leaked = () => import("@modelcontextprotocol/sdk/server/mcp.js");', "cli/run.ts loads @modelcontextprotocol/sdk/server/mcp.js outside src/mcp"],
      ["the root CLI entry reaching the MCP server", "index.ts", 'export { createMcpServer } from "./mcp/index.js";', "@docture/cli statically reaches cli/mcp/index.ts"],
      ["a runtime import in the config entry", "define-config.ts", 'import { UsageError } from "./cli/errors.js";\nexport const leaked = UsageError;', "@docture/cli/config must import and re-export types only"],
    ];
    for (const [name, file, code, message] of cliCases) {
      await t.test(`rejects ${name}`, async () => {
        const path = join(cli, file);
        const original = await readFile(path, "utf8");
        try {
          await writeFile(path, `${original}\n${code}\n`);
          const result = check();
          assert.notEqual(result.status, 0, `${name} must be rejected`);
          assert.ok(result.stderr.includes(message), result.stdout + result.stderr);
        } finally {
          await writeFile(path, original);
        }
      });
    }
    const evalRoot = join(directory, "packages/eval");
    const evalCases = [
      ["root cannot reach dataset", "probe.ts", 'export * from "./dataset/index.js";', "crosses into"],
      ["root cannot reach config", "probe.ts", 'export * from "./config.js";', "crosses into"],
      ["unknown root directories stay portable", "helpers/probe.ts", 'import "node:fs";', "Node built-in outside node/"],
      ["dataset cannot reach runner", "dataset/probe.ts", 'import type { X } from "../runner/index.js";', "crosses into"],
      ["runner cannot reach node", "runner/probe.ts", 'import "../node/index.js";', "crosses into"],
      ["runner cannot reach calibration", "runner/probe.ts", 'import "../calibration/index.js";', "crosses into"],
      ["node cannot reach comparison", "node/probe.ts", 'import "../comparison/index.js";', "crosses into"],
      ["docture cannot reach dataset", "docture/probe.ts", 'import "../dataset/index.js";', "crosses into"],
      ["docture cannot reach node", "docture/probe.ts", 'import "../node/index.js";', "crosses into"],
      ["comparison cannot reach calibration", "comparison/probe.ts", 'import "../calibration/index.js";', "crosses into"],
      ["calibration cannot reach grounding", "calibration/probe.ts", 'import "../grounding/index.js";', "crosses into"],
      ["grounding cannot reach conversion", "grounding/probe.ts", 'import "../conversion/index.js";', "crosses into"],
      ["conversion cannot reach dataset", "conversion/probe.ts", 'import "../dataset/index.js";', "crosses into"],
      ["reporters cannot reach each other", "reporters/html/probe.ts", 'import "../json/index.js";', "crosses into"],
      ["shared reporter helpers cannot reach reporters", "reporters/shared/probe.ts", 'import "../json/index.js";', "crosses into"],
      ["shared reporter helpers cannot write files", "reporters/shared/probe.ts", 'import "../../node/artifacts.js";', "crosses into"],
      ["reporters reach node only for atomic writes", "reporters/json/probe.ts", 'import "../../node/store.js";', "crosses into"],
      ["reporters cannot reach the runner", "reporters/terminal/probe.ts", 'import "../../runner/index.js";', "crosses into"],
      ["reporters cannot import Node built-ins", "reporters/json/probe.ts", 'import "node:path";', "Node built-in outside node/"],
      ["adapters cannot reach each other", "adapters/vitest/probe.ts", 'import "../evalite/index.js";', "crosses into"],
      ["config cannot reach runner", "config.ts", 'import "./runner/index.js";', "crosses into"],
      ["AI SDK is confined to judge", "probe.ts", 'export type Model = import("ai").LanguageModel;', "imports ai outside judge/"],
      ["LLM types are confined to docture", "probe.ts", 'export type { PricingTable } from "docture/llm/pricing";', "imports docture/llm outside docture/"],
      ["runtime docture subpaths are forbidden", "docture/probe.ts", 'export * from "docture/llm/text";', "imports runtime docture subpath"],
      ["inline types still create runtime docture imports", "probe.ts", 'import { type X } from "docture/chunk";', "imports runtime docture subpath"],
      ["internal package aliases are forbidden", "probe.ts", 'import "@docture/eval/dataset";', "use relative internal imports"],
      ["relative imports cannot escape eval", "probe.ts", 'import "../../docture/src/index.js";', "crosses into"],
      ["computed dynamic imports are forbidden", "probe.ts", 'export const load = () => import(process.env.ENGINE);', "computed module specifier"],
      ["invalid eval syntax is rejected", "probe.ts", 'export const broken = ;', "cannot be parsed"],
      ["eval uses ESM sources", "probe.cts", 'export const value = 1;', "CommonJS source .cts"],
    ];
    for (const [name, file, code, message] of evalCases) {
      await t.test(`rejects eval ${name}`, async () => {
        const path = join(evalRoot, "src", file);
        const original = await readFile(path, "utf8").catch(() => undefined);
        await mkdir(join(path, ".."), { recursive: true });
        try {
          await writeFile(path, code);
          const result = check();
          assert.notEqual(result.status, 0, name);
          assert.ok(result.stderr.includes(message), result.stdout + result.stderr);
        } finally {
          if (original === undefined) await rm(path); else await writeFile(path, original);
        }
      });
    }
    for (const [name, file, code] of [
      ["root core helpers", "spec/probe.ts", 'export * from "../compare/index.js";'],
      ["runner dataset helpers", "runner/probe.ts", 'export * from "../dataset/index.js";'],
      ["runner run comparison", "runner/probe.ts", 'export * from "../comparison/index.js";'],
      ["node runner and dataset at runtime", "node/probe.ts", 'export * from "../runner/index.js"; export * from "../dataset/index.js";'],
      ["docture runner at runtime and pricing", "docture/probe.ts", 'export * from "../runner/index.js"; export * from "docture/llm/pricing";'],
      ["reporter shared helpers", "reporters/html/probe.ts", 'export * from "../shared/index.js";'],
      ["reporter atomic writes", "reporters/json/probe.ts", 'export { writeFileAtomic } from "../../node/artifacts.js";'],
      ["shared reporter helpers reading the root", "reporters/shared/probe.ts", 'export type { EvalResult } from "../../result/types.js";'],
      ["portable docture types", "probe.ts", 'export type { X } from "docture/chunk";'],
      ["test Node imports", "probe.test.ts", 'import "node:assert/strict";'],
    ]) {
      await t.test(`permits eval ${name}`, async () => {
        const path = join(evalRoot, "src", file);
        await mkdir(join(path, ".."), { recursive: true });
        try {
          await writeFile(path, code);
          const result = check();
          assert.equal(result.status, 0, result.stdout + result.stderr);
        } finally { await rm(path); }
      });
    }
    await t.test("rejects an undeclared package even when private", async () => {
      const path = join(directory, "packages/unknown");
      await mkdir(path);
      try {
        await writeFile(join(path, "package.json"), JSON.stringify({ name: "unknown", private: true }));
        assert.notEqual(check().status, 0);
      } finally { await rm(path, { recursive: true }); }
    });
    await t.test("accepts eval before and after publication", async () => {
      const path = join(evalRoot, "package.json");
      const original = await readFile(path, "utf8");
      try {
        for (const privateFlag of [true, false]) {
          await writeFile(path, JSON.stringify({ ...JSON.parse(original), private: privateFlag }));
          const result = check();
          assert.equal(result.status, 0, result.stdout + result.stderr);
        }
      } finally { await writeFile(path, original); }
    });
    await t.test("rejects mismatched eval engine ranges", async () => {
      const path = join(evalRoot, "src/judge/index.ts");
      const original = await readFile(path, "utf8");
      try {
        await writeFile(path, original.replace(/ENGINE_RANGES = \{[^}]*\}/, 'ENGINE_RANGES = { ai: "0.0.0" }'));
        const result = check();
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes("eval ENGINE_RANGES"), result.stdout + result.stderr);
      } finally { await writeFile(path, original); }
    });
    for (const [name, mutate] of [
      ["side-effectful eval metadata", value => { value.sideEffects = true; }],
      ["an optional docture peer", value => { value.peerDependenciesMeta = { docture: { optional: true } }; }],
      ["a missing docture peer", value => { delete value.peerDependencies.docture; }],
      ["wildcard eval exports", value => { value.exports["./*"] = value.exports["."]; }],
      ["bundled eval runtime targets", value => { value.exports["."].import = "./dist/bundle.js"; }],
      ["wrong eval declaration targets", value => { value.exports["."].types = "./dist/bundle.d.ts"; }],
    ]) {
      await t.test(`rejects ${name}`, async () => {
        const path = join(evalRoot, "package.json");
        const original = await readFile(path, "utf8");
        try {
          const value = JSON.parse(original);
          mutate(value);
          await writeFile(path, JSON.stringify(value));
          assert.notEqual(check().status, 0, name);
        } finally { await writeFile(path, original); }
      });
    }
    await t.test("keeps the original publications public", async () => {
      const path = join(directory, "packages/cli/package.json");
      const original = await readFile(path, "utf8");
      try {
        await writeFile(path, JSON.stringify({ ...JSON.parse(original), private: true }));
        assert.notEqual(check().status, 0);
      } finally { await writeFile(path, original); }
    });
    await t.test("permits judge AI imports only with declared optional engine ranges", async () => {
      const path = join(evalRoot, "package.json");
      const original = await readFile(path, "utf8");
      const judge = join(evalRoot, "src/judge/index.ts");
      const judgeSource = await readFile(judge, "utf8");
      const ranges = /ENGINE_RANGES = \{[^}]*\}/;
      try {
        const value = JSON.parse(original);
        value.peerDependencies.ai = "1.0.0";
        value.peerDependenciesMeta = { ai: { optional: true } };
        await writeFile(path, JSON.stringify(value));
        await writeFile(judge, judgeSource.replace(ranges, 'ENGINE_RANGES = { ai: "1.0.0" }'));
        let result = check();
        assert.equal(result.status, 0, result.stdout + result.stderr);
        value.peerDependenciesMeta.ai.optional = false;
        await writeFile(path, JSON.stringify(value));
        result = check();
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes("must be an optional eval peer"), result.stdout + result.stderr);
        await writeFile(judge, judgeSource.replace(/export const ENGINE_RANGES = \{[^}]*\} as const;/, ""));
        result = check();
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes("eval judge declares one ENGINE_RANGES table"), result.stdout + result.stderr);
      } finally {
        await writeFile(path, original);
        await writeFile(judge, judgeSource);
      }
    });
    await t.test("rejects a stale generated HTML client", async () => {
      const path = join(evalRoot, "scripts/build-html-client.mjs");
      await mkdir(join(path, ".."), { recursive: true });
      try {
        await writeFile(path, 'if (!process.argv.includes("--check")) throw new Error("missing flag"); process.exit(1);');
        const result = check();
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes("eval HTML client must be fresh"), result.stdout + result.stderr);
      } finally { await rm(join(evalRoot, "scripts"), { recursive: true }); }
    });
    await t.test("passes after removing the foreign import", control);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
