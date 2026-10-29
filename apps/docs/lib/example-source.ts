import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const examplesRoot = resolve(process.cwd(), "examples");

export async function readExampleSource(file: string): Promise<string> {
  const path = resolve(examplesRoot, file);
  if (!path.startsWith(`${examplesRoot}${sep}`)) throw new Error(`Example path leaves the examples directory: ${file}`);
  return (await readFile(path, "utf8")).trimEnd();
}

export async function expandSourceExamples(markdown: string): Promise<string> {
  const tags = [...markdown.matchAll(/<SourceExample\s+file=["']([^"']+)["'][^>]*\/>/g)];
  const examples = await Promise.all(tags.map(async (tag) => ({ tag: tag[0], lang: tag[1]?.endsWith(".tsx") ? "tsx" : "ts", source: await readExampleSource(tag[1] ?? "") })));
  for (const example of examples) markdown = markdown.replace(example.tag, () => `\`\`\`${example.lang}\n${example.source}\n\`\`\``);
  return markdown;
}
