export interface ApiSymbolRecord {
  readonly packageName: string;
  readonly symbol: string;
  readonly importPaths: readonly string[];
  readonly url: string;
  readonly markdownUrl: string;
  readonly description: string;
}

export function apiSymbolsMarkdown(symbols: readonly ApiSymbolRecord[]): string {
  return ["| Symbol | Import | Reference |", "| --- | --- | --- |", ...symbols.map((item) =>
    `| \`${item.symbol}\` | ${item.importPaths.map((path) => `\`${path}\``).join(", ")} | [${item.description.replace(/\|/g, "\\|") || item.symbol}](${item.url}) |`), ""].join("\n");
}
