import type { Nodes, Root } from "mdast";

export function remarkCodeExamples() {
  return (tree: Root) => {
    let number = 0;
    function visit(node: Nodes): void {
      if (node.type === "code") {
        number += 1;
        const kind = /(?:^|\s)check(?:\s|$)/.test(node.meta ?? "") ? "Type-checked example"
          : /(?:^|\s)signature(?:\s|$)/.test(node.meta ?? "") ? "Reference signature"
          : /(?:^|\s)expect-error(?:\s|$)/.test(node.meta ?? "") ? "Expected error"
          : "Code excerpt";
        node.meta = `${node.meta ?? ""} data-example-label="${kind} ${number}"`.trim();
      } else if ("children" in node) for (const child of node.children) visit(child);
    }
    visit(tree);
  };
}
