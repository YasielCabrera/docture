import type { Nodes } from "mdast";
import { remark } from "remark";

const PACKAGE_TABS = /<CodeBlockTabs[^>]*>[\s\S]*?<CodeBlockTab value="npm">\s*```(\w*)\n\s*([^\n]+)\n\s*```[\s\S]*?<\/CodeBlockTabs>/g;
const CARDS = /<Cards[^>]*>([\s\S]*?)<\/Cards>/g;
const CARD = /<Card\s+title="([^"]*)"\s+href="([^"]*)"(?:\s+description="([^"]*)")?[^>]*\/>/g;

function codeRanges(markdown: string): Array<{ start: number; end: number; block: boolean }> {
  const ranges: Array<{ start: number; end: number; block: boolean }> = [];
  function visit(node: Nodes): void {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push({ start, end, block: node.type === "code" });
    } else if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(remark().parse(markdown));
  return ranges;
}

function replaceOutsideCode(markdown: string, pattern: RegExp, replace: (match: RegExpExecArray) => string): string {
  const ranges = codeRanges(markdown);
  for (const match of [...markdown.matchAll(pattern)].reverse()) {
    if (ranges.some(({ start, end }) => match.index >= start && match.index < end)) continue;
    markdown = markdown.slice(0, match.index) + replace(match) + markdown.slice(match.index + match[0].length);
  }
  return markdown;
}

export async function transformMarkdownHtml(markdown: string, transform: (html: string) => string | Promise<string>): Promise<string> {
  const blocks: Array<{ start: number; end: number; text: string }> = [];
  function visit(node: Nodes): void {
    if (node.type === "html") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) throw new Error("Markdown HTML has no source position");
      blocks.push({ start, end, text: node.value });
    } else if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(remark().parse(markdown));
  for (const block of blocks.reverse()) {
    markdown = markdown.slice(0, block.start) + await transform(block.text) + markdown.slice(block.end);
  }
  return markdown;
}

export function transformMarkdownProse(markdown: string, transform: (prose: string) => string): string {
  const result: string[] = [];
  let prose: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined && marker !== undefined) {
      if (prose.length > 0) result.push(transform(prose.join("\n")));
      prose = [];
      fence = marker;
      result.push(line);
    } else if (fence !== undefined) {
      result.push(line);
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
    } else prose.push(line);
  }
  if (prose.length > 0) result.push(transform(prose.join("\n")));
  return result.join("\n");
}

export function toAgentMarkdown(markdown: string): string {
  markdown = replaceOutsideCode(markdown, PACKAGE_TABS, ([, lang, command]) => `\`\`\`${lang || "bash"}\n${command?.trim()}\n\`\`\``);
  markdown = replaceOutsideCode(markdown, CARDS, ([, cards]) =>
    [...(cards ?? "").matchAll(CARD)].map(([, title, href, description]) => `- [${title}](${href})${description ? `: ${description}` : ""}`).join("\n"));
  markdown = replaceOutsideCode(markdown, /^(#{1,6} .*?) \[#[^\]\s]+\]$/gm, ([, heading]) => heading ?? "");
  markdown = replaceOutsideCode(markdown, /^\{\/\*.*?\*\/\}\n/gm, () => "");
  for (const { start, block } of codeRanges(markdown).reverse()) {
    if (!block) continue;
    const end = markdown.indexOf("\n", start);
    if (end < 0) continue;
    const line = markdown.slice(start, end);
    if (!/^(?:`{3,}|~{3,})/.test(line)) continue;
    const opener = line
      .replace(/\s+data-example-label="[^"]*"/g, "")
      .replace(/^(`{3,}|~{3,})(tsx?) check(?=\s|$)/, "$1$2");
    markdown = markdown.slice(0, start) + opener + markdown.slice(end);
  }
  return markdown;
}
