const PACKAGE_TABS = /<CodeBlockTabs[^>]*>[\s\S]*?<CodeBlockTab value="npm">\s*```(\w*)\n\s*([^\n]+)\n\s*```[\s\S]*?<\/CodeBlockTabs>/g;
const CARDS = /<Cards[^>]*>([\s\S]*?)<\/Cards>/g;
const CARD = /<Card\s+title="([^"]*)"\s+href="([^"]*)"(?:\s+description="([^"]*)")?[^>]*\/>/g;

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
  return markdown
    .replace(PACKAGE_TABS, (_match, lang: string, command: string) => `\`\`\`${lang || "bash"}\n${command.trim()}\n\`\`\``)
    .replace(CARDS, (_match, cards: string) =>
      [...cards.matchAll(CARD)].map(([, title, href, description]) => `- [${title}](${href})${description ? `: ${description}` : ""}`).join("\n"))
    .replace(/^(#{1,6} .*?) \[#[^\]\s]+\]$/gm, "$1")
    .replace(/^(\s*```[^\n]*?)\s+data-example-label="[^"]*"/gm, "$1")
    .replace(/^(```tsx?) check(?=\s|$)/gm, "$1")
    .replace(/^\{\/\*.*?\*\/\}\n/gm, "");
}
