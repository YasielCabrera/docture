import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { API_INVENTORY } from "../api-reference.js";
import { apiSymbols } from "./api-symbols.js";

const root = resolve(import.meta.dirname, "..");
const file = resolve(root, "content/docs/api.mdx");
const docs = resolve(root, "content/docs");
const pages = new Map(await Promise.all((await readdir(docs, { recursive: true })).filter((path) => path.endsWith(".mdx")).map(async (path) =>
  [`content/docs/${path.split(sep).join("/")}`, await readFile(resolve(docs, path), "utf8")] as const)));
const symbols = apiSymbols(API_INVENTORY, pages);
const lines = ["---", "title: API index", "description: Find public symbols, their import paths, and their canonical reference sections.", "type: reference", "---", "", "Find a symbol by name, import path, or package. Import public entries rather than files under `src` or `dist`. Install the engines required by the [package reference](/docs/getting-started/reference/packages).", "", "## Symbols", "", "The [symbol index as JSON](/api-symbols.json) contains the same symbols, imports, descriptions, and reference links.", "", "<ApiIndex />", "", "## Entry points", "", "Each entry below links to its canonical reference pages.", ""];
for (const [name, title] of [["docture", "Core"], ["@docture/cli", "CLI and services"], ["@docture/eval", "Evaluation"], ["@docture/synthetic", "Synthetic data"]]) {
  lines.push(`### ${title}`, "", "| Import | Reference |", "| --- | --- |");
  for (const item of API_INVENTORY.filter((item) => item.packageName === name)) {
    const links = await Promise.all(Object.keys(item.pages).map(async (page) => {
      const source = await readFile(resolve(import.meta.dirname, "..", page), "utf8");
      const title = /^title: (.+)$/m.exec(source)?.[1]?.replace(/^"|"$/g, "") ?? page;
      const route = "/docs/" + page.replace(/^content\/docs\//, "").replace(/\.mdx$/, "").replace(/\/index$/, "");
      return `[${title}](${route})`;
    }));
    lines.push(`| \`${item.importPath}\` | ${links.join(", ")} |`);
  }
  lines.push("");
}
lines.push("The evaluation result JSON Schema is also published as `@docture/eval/result-v1.schema.json`. See the [result format](/docs/evaluation/reference/results).", "");
const content = lines.join("\n");
for (const [path, generated] of [[file, content], [resolve(root, "public/api-symbols.json"), `${JSON.stringify(symbols, null, 2)}\n`]]) {
  if (process.argv.includes("--check")) {
    if (await readFile(path, "utf8") !== generated) throw new Error("API index is stale. Run pnpm --filter @docture/docs generate:api.");
  } else await writeFile(path, generated);
}
console.log(`API index ${process.argv.includes("--check") ? "verified" : "generated"}: ${API_INVENTORY.length} public entries and ${symbols.length} symbol references.`);
