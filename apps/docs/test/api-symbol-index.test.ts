import { describe, expect, it } from "vitest";
import { apiSymbols, symbolReference } from "../scripts/api-symbols.js";
import { apiSymbolsMarkdown } from "../lib/api-symbol-markdown.js";
import type { ApiEntrypointInventory } from "../api-reference.js";
import { API_INVENTORY } from "../api-reference.js";
import { readFile, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";

const page = "content/docs/reference/example.mdx";
const source = [
  "---", "title: Example API", "description: Example contracts and helpers.", "---", "",
  "```ts", 'import { Example, Helper } from "docture";', "```", "",
  "## Contracts", "",
  "### `Example`", "", "An example value with a stable identity.", "",
  "```ts", "interface Example { id: string }", "```", "",
  "### Helpers", "", "Helpers operate on example values.", "",
  "```ts", "type Helper = (value: Example) => string;", "```", "",
].join("\n");

describe("public API symbol references", () => {
  it("preserves underscores in rendered symbol fragments", () => {
    const content = "### `RESULT_FORMAT`\n\nThe result format marker.\n";
    expect(symbolReference(page, "RESULT_FORMAT", new Map([[page, content]]))).toEqual({
      url: "/docs/reference/example#result_format", description: "The result format marker.",
    });
  });
  it("links exact symbols and non-heading declarations to their real contract sections", () => {
    const pages = new Map([[page, source]]);
    expect(symbolReference(page, "Example", pages)).toEqual({
      url: "/docs/reference/example#example", description: "An example value with a stable identity.",
    });
    expect(symbolReference(page, "Helper", pages)).toEqual({
      url: "/docs/reference/example#helpers", description: "Helpers operate on example values.",
    });
  });

  it("groups public import aliases without losing their canonical contract", () => {
    const inventory: readonly ApiEntrypointInventory[] = [
      { packageName: "docture", importPath: "docture", entrypoint: "core.ts", pages: { [page]: ["Example"] } },
      { packageName: "docture", importPath: "docture/node", entrypoint: "node.ts", pages: { [page]: ["Example"] } },
    ];
    const records = apiSymbols(inventory, new Map([[page, source]]));
    expect(records).toEqual([{
      packageName: "docture", symbol: "Example", importPaths: ["docture", "docture/node"],
      url: "/docs/reference/example#example", description: "An example value with a stable identity.",
    }]);
    expect(apiSymbolsMarkdown(records)).toBe([
      "| Symbol | Import | Reference |", "| --- | --- | --- |",
      "| `Example` | `docture`, `docture/node` | [An example value with a stable identity.](/docs/reference/example#example) |", "",
    ].join("\n"));
  });

  it("ignores headings inside code and uses the actual duplicate-heading anchor", () => {
    const content = [
      "## Fields", "", "The first group.", "",
      "```md", "### `Nested`", "```", "",
      "## Fields", "", "The second group.", "", "type Nested = string;", "",
    ].join("\n");
    expect(symbolReference(page, "Nested", new Map([[page, content]]))).toEqual({
      url: "/docs/reference/example#fields-1", description: "The second group.",
    });
  });

  it("resolves a linked type to its own contract instead of a function that returns it", () => {
    const target = "content/docs/reference/values.mdx";
    const pages = new Map([
      [page, "## Helpers\n\n### render\n\nReturns a [`Value`](/docs/reference/values#render).\n"],
      [target, "## Values\n\n### `Value`\n\nA value with source identity.\n\n### render\n\nA value renderer.\n"],
    ]);
    expect(symbolReference(page, "Value", pages)).toEqual({
      url: "/docs/reference/values#value", description: "A value with source identity.",
    });
  });

  it("rejects an import-only name instead of inventing a symbol anchor", () => {
    expect(() => symbolReference(page, "Unused", new Map([[page, "## Import\n\n```ts\nimport { Unused } from 'docture';\n```\n"]])))
      .toThrow("Unused needs a documented contract outside an import");
  });

  it("keeps distinct same-named exports within their import sections", () => {
    const content = [
      "## `@docture/synthetic/faker`", "", "### `ENGINE_RANGES`", "", "The supported Faker engine.", "",
      "## `@docture/synthetic/llm`", "", "### `ENGINE_RANGES`", "", "The supported AI engine.", "",
    ].join("\n");
    const inventory: readonly ApiEntrypointInventory[] = [
      { packageName: "@docture/synthetic", importPath: "@docture/synthetic/faker", entrypoint: "faker.ts", pages: { [page]: ["ENGINE_RANGES"] } },
      { packageName: "@docture/synthetic", importPath: "@docture/synthetic/llm", entrypoint: "llm.ts", pages: { [page]: ["ENGINE_RANGES"] } },
    ];
    expect(apiSymbols(inventory, new Map([[page, content]]))).toEqual([
      { packageName: "@docture/synthetic", symbol: "ENGINE_RANGES", importPaths: ["@docture/synthetic/faker"], url: "/docs/reference/example#engine_ranges", description: "The supported Faker engine." },
      { packageName: "@docture/synthetic", symbol: "ENGINE_RANGES", importPaths: ["@docture/synthetic/llm"], url: "/docs/reference/example#engine_ranges-1", description: "The supported AI engine." },
    ]);
  });

  it("rejects incidental prose as a symbol contract", () => {
    expect(() => symbolReference(page, "before", new Map([[page, "## Errors\n\nValidate the input before rendering the document.\n"]])))
      .toThrow("before needs a documented contract outside an import");
  });

  it("uses explicitly named options tables as contracts", () => {
    const content = "## Connection\n\nConnection settings.\n\n{/* options: ConnectionOptions */}\n| Option | Meaning |\n| --- | --- |\n| `url` | The server URL. |\n";
    expect(symbolReference(page, "ConnectionOptions", new Map([[page, content]]))).toEqual({
      url: "/docs/reference/example#connection", description: "Connection settings.",
    });
  });

  it("keeps a fence open when a delimiter-like line has an info string", () => {
    const content = "~~~md\n~~~ts\n### `Nested`\n~~~\n\n## Contracts\n\nActual contracts.\n\ntype Nested = string;\n";
    expect(symbolReference(page, "Nested", new Map([[page, content]]))).toEqual({
      url: "/docs/reference/example#contracts", description: "Actual contracts.",
    });
  });

  it("rejects ambiguous same-named contracts without an owning entry", () => {
    const content = "## First\n\n### `Value`\n\nFirst value.\n\n## Second\n\n### `Value`\n\nSecond value.\n";
    expect(() => symbolReference(page, "Value", new Map([[page, content]])))
      .toThrow("Value has ambiguous reference headings");
  });

  it("prefers a named contract over its unformatted category heading", () => {
    const content = "## Extractor\n\n### `Extractor`\n\nThe extractor class contract.\n";
    expect(symbolReference(page, "Extractor", new Map([[page, content]]))).toEqual({
      url: "/docs/reference/example#extractor-1", description: "The extractor class contract.",
    });
  });

  it("resolves current entry exports to their defining contracts", async () => {
    const docs = resolve(import.meta.dirname, "../content/docs");
    const files = (await readdir(docs, { recursive: true })).filter((file) => file.endsWith(".mdx"));
    const pages = new Map(await Promise.all(files.map(async (file) =>
      [`content/docs/${file.split(sep).join("/")}`, await readFile(resolve(docs, file), "utf8")] as const)));
    const records = apiSymbols(API_INVENTORY, pages);
    const contracts = [
      ["docture", "Extractor", "/docs/extraction/reference/extractor#extractor-1"],
      ["@docture/eval/reporters/html", "panel", "/docs/evaluation/reference/reporters-html#panel"],
      ["@docture/synthetic", "Model", "/docs/synthetic/reference/models#model"],
      ["@docture/synthetic", "Generator", "/docs/synthetic/reference/models#generator"],
      ["@docture/synthetic", "Sample", "/docs/synthetic/reference/models#sample"],
      ["@docture/synthetic", "gen", "/docs/synthetic/reference/models#gen"],
      ["@docture/synthetic", "Fields", "/docs/synthetic/reference/models#path-types"],
      ["@docture/synthetic", "JsonSchema", "/docs/synthetic/reference/models#schemas"],
      ["@docture/synthetic", "scenario", "/docs/synthetic/reference/models#scenario"],
      ["@docture/synthetic", "Template", "/docs/synthetic/reference/templates#template"],
      ["@docture/synthetic", "before", "/docs/synthetic/reference/constraints#before"],
      ["@docture/synthetic", "constraint", "/docs/synthetic/reference/constraints#constraint"],
      ["@docture/synthetic/node", "digital", "/docs/synthetic/reference/node#digital"],
      ["@docture/synthetic/node", "scan", "/docs/synthetic/reference/node#scan"],
      ["@docture/synthetic/node", "photo", "/docs/synthetic/reference/node#photo"],
      ["@docture/synthetic/node", "fax", "/docs/synthetic/reference/node#fax"],
      ["@docture/synthetic/degrade", "ENGINE_RANGES", "/docs/synthetic/reference/degrade#engine_ranges"],
      ["@docture/synthetic/faker", "ENGINE_RANGES", "/docs/synthetic/reference/text-generators#engine_ranges"],
      ["@docture/synthetic/llm", "ENGINE_RANGES", "/docs/synthetic/reference/text-generators#engine_ranges-1"],
      ["@docture/synthetic/html", "ENGINE_RANGES", "/docs/synthetic/reference/html#engine_ranges"],
    ] as const;
    for (const [importPath, symbol, url] of contracts) {
      expect(records.find((record) => record.symbol === symbol && record.importPaths.includes(importPath))?.url,
        `${importPath}: ${symbol}`).toBe(url);
    }
  });

  it("prefers a defining table cell over an earlier field's referenced type", () => {
    const content = "## Uses\n\nUses these types.\n\n| Field | Type |\n| --- | --- |\n| `fields` | `Fields<T>` |\n\n## Path types\n\nPath contracts.\n\n| Type | Meaning |\n| --- | --- |\n| `Fields<T>` | A mapping of field generators. |\n";
    expect(symbolReference(page, "Fields", new Map([[page, content]]))).toEqual({
      url: "/docs/reference/example#path-types", description: "Path contracts.",
    });
  });
});
