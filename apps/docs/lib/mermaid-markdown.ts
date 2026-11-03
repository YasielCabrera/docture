import type { Nodes, Root } from "mdast";

function diagramMarkdown(chart: string): string {
  const title = /^\s*accTitle:\s*(.+)$/m.exec(chart)?.[1];
  const description = /^\s*accDescr:\s*(.+)$/m.exec(chart)?.[1];
  const summary = [title, description].filter(Boolean).join(". ");
  const longest = Math.max(2, ...[...chart.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${summary ? `${summary}\n\n` : ""}${fence}mermaid\n${chart}\n${fence}`;
}

export function remarkMermaidMarkdown() {
  return (tree: Root) => {
    function visit(node: Nodes): void {
      if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === "Mermaid") {
        const chart = node.attributes.find((attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "chart");
        if (chart?.type === "mdxJsxAttribute" && typeof chart.value === "string") {
          node.data = { ...node.data, _stringify: { text: diagramMarkdown(chart.value) } };
        }
      } else if ("children" in node) for (const child of node.children) visit(child);
    }
    visit(tree);
  };
}
