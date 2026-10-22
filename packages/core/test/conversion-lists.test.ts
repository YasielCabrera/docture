import { describe, expect, it } from "vitest";
import { DocumentConverter, type LoadedDocument, type TextLayoutBlock } from "../src/index.js";

function block(text: string, y: number, role?: TextLayoutBlock["role"]): TextLayoutBlock {
  return {
    id: `block-${y}`,
    kind: "text",
    x: 20,
    y,
    width: 200,
    height: 12,
    ...(role === undefined ? {} : { role }),
    ...(role === "heading" ? { level: 1 } : {}),
    lines: [{
      text,
      y,
      height: 12,
      spans: [{ text, x: 20, y, width: 200, height: 12 }],
    }],
  };
}

function document(blocks: readonly TextLayoutBlock[]): LoadedDocument {
  const text = blocks.flatMap((item) => item.lines.map((line) => line.text)).join("\n");
  return {
    loader: "tagged-list-fixture",
    form: "digital",
    text,
    pages: [{ pageNumber: 1, width: 600, height: 800, text, blocks }],
  };
}

describe("unmarked tagged list boundaries", () => {
  it("keeps two paragraphs and a heading after an unmarked list item", async () => {
    const result = await new DocumentConverter().convert({
      loaded: document([
        block("First", 20, "list-item"),
        block("Para A", 50),
        block("Para B", 80),
        block("Section", 110, "heading"),
      ]),
    });

    expect(result.pages[0]?.elements.map((element) =>
      element.kind === "list"
        ? { kind: element.kind, ordered: element.ordered, items: element.items.map((item) => item.text) }
        : { kind: element.kind, text: "text" in element ? element.text : undefined },
    )).toEqual([
      { kind: "list", ordered: false, items: ["First"] },
      { kind: "paragraph", text: "Para A" },
      { kind: "paragraph", text: "Para B" },
      { kind: "heading", text: "Section" },
    ]);
    expect(result.content).toBe("<!-- page: 1 -->\n\n- First\n\nPara A\n\nPara B\n\n# Section");
  });

  it("groups consecutive unmarked list items before the next paragraph", async () => {
    const result = await new DocumentConverter().convert({
      loaded: document([
        block("First", 20, "list-item"),
        block("Second", 50, "list-item"),
        block("After the list", 80),
      ]),
    });

    expect(result.pages[0]?.elements.map((element) =>
      element.kind === "list"
        ? { kind: element.kind, ordered: element.ordered, items: element.items.map((item) => item.text) }
        : { kind: element.kind, text: "text" in element ? element.text : undefined },
    )).toEqual([
      { kind: "list", ordered: false, items: ["First", "Second"] },
      { kind: "paragraph", text: "After the list" },
    ]);
    expect(result.content).toBe("<!-- page: 1 -->\n\n- First\n- Second\n\nAfter the list");
  });
});
