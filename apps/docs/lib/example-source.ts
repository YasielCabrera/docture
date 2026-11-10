import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { transformMarkdownHtml } from "./agent-markdown";

const examplesRoot = resolve(process.cwd(), "examples");

export async function readExampleSource(file: string): Promise<string> {
  const path = resolve(examplesRoot, file);
  if (!path.startsWith(`${examplesRoot}${sep}`)) throw new Error(`Example path leaves the examples directory: ${file}`);
  return (await readFile(path, "utf8")).trimEnd();
}

export async function expandSourceExamples(markdown: string): Promise<string> {
  return transformMarkdownHtml(markdown, async (html) => {
    const tags = [...html.matchAll(/<SourceExample\s+file=["']([^"']+)["'][^>]*\/>/g)];
    for (const tag of tags) {
      const file = tag[1] ?? "";
      const title = /\btitle=(["'])(.*?)\1/.exec(tag[0])?.[2] ?? file;
      const source = await readExampleSource(file);
      const fence = "`".repeat(Math.max(2, ...[...source.matchAll(/`+/g)].map((match) => match[0].length)) + 1);
      html = html.replace(tag[0], () => `${fence}${file.endsWith(".tsx") ? "tsx" : "ts"} title=${JSON.stringify(title)}\n${source}\n${fence}`);
    }
    return html;
  });
}
