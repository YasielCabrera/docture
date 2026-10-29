import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { API_INVENTORY } from "../api-reference.js";

const file = resolve(import.meta.dirname, "../content/docs/api.mdx");
const lines = ["---", "title: API reference", "description: Find public APIs by package and import path.", "---", "", "Each entry below links to its canonical reference pages. Import public entries rather than files under `src` or `dist`. Install the engines required by the [package reference](/docs/getting-started/reference/packages).", ""];
for (const [name, title] of [["docture", "Core"], ["@docture/cli", "CLI and services"], ["@docture/eval", "Evaluation"], ["@docture/synthetic", "Synthetic data"]]) {
  lines.push(`## ${title}`, "", "| Import | Reference |", "| --- | --- |");
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
if (process.argv.includes("--check")) {
  if (await readFile(file, "utf8") !== content) throw new Error("API index is stale. Run pnpm --filter @docture/docs generate:api.");
} else await writeFile(file, content);
console.log(`API index ${process.argv.includes("--check") ? "verified" : "generated"}: ${API_INVENTORY.length} public entries.`);
