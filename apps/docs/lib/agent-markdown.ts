const PACKAGE_TABS = /<CodeBlockTabs[^>]*>[\s\S]*?<CodeBlockTab value="npm">\s*```(\w*)\n\s*([^\n]+)\n\s*```[\s\S]*?<\/CodeBlockTabs>/g;
const CARDS = /<Cards[^>]*>([\s\S]*?)<\/Cards>/g;
const CARD = /<Card\s+title="([^"]*)"\s+href="([^"]*)"(?:\s+description="([^"]*)")?[^>]*\/>/g;

export function toAgentMarkdown(markdown: string): string {
  return markdown
    .replace(PACKAGE_TABS, (_match, lang: string, command: string) => `\`\`\`${lang || "bash"}\n${command.trim()}\n\`\`\``)
    .replace(CARDS, (_match, cards: string) =>
      [...cards.matchAll(CARD)].map(([, title, href, description]) => `- [${title}](${href})${description ? `: ${description}` : ""}`).join("\n"))
    .replace(/^(#{1,6} .*?) \[#[^\]\s]+\]$/gm, "$1")
    .replace(/^(```tsx?) check$/gm, "$1")
    .replace(/^\{\/\*.*?\*\/\}\n/gm, "");
}
