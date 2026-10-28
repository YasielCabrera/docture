import type { LayoutAnnotation, LayoutDocument, LoadedDocument, TextLine, TextSpan, TextLayoutBlock } from "../../src/core/index.js";

export function span(
  text: string,
  x: number,
  y: number,
  options: Partial<TextSpan> = {},
): TextSpan {
  return { text, x, y, width: Math.max(10, text.length * 5), height: 12, ...options };
}

export function line(y: number, spans: readonly TextSpan[], text = spans.map((item) => item.text).join(" ")): TextLine {
  return { y, height: 12, text, spans };
}

export function richDocument(): LoadedDocument {
  const heading = line(20, [span("Quarterly Report", 20, 20, { style: { fontSize: 24, bold: true } })]);
  const paragraph = line(60, [
    span("A *literal* <value>. Visit", 20, 60, { style: { fontSize: 11 } }),
    span("Docture", 165, 60, { href: "https://example.com/docs", style: { fontSize: 11 } }),
    span("unsafe", 210, 60, { href: "javascript:alert(1)", style: { fontSize: 11 } }),
  ]);
  const first = line(100, [span("• First", 20, 100)]);
  const second = line(120, [span("• Second", 20, 120)]);
  const tableHeader = line(170, [span("Name", 20, 170), span("Value", 180, 170)]);
  const tableRow = line(190, [span("Alpha", 20, 190), span("10", 180, 190)]);
  const code = line(240, [span("const exact = '<&>';", 20, 240, { style: { monospace: true } })]);
  const last = line(30, [span("Second page", 20, 30)]);

  return {
    loader: "fixture",
    form: "digital",
    text: [
      [heading, paragraph, first, second, tableHeader, tableRow, code].map((value) => value.text).join("\n"),
      last.text,
    ].join("\f"),
    metadata: { title: "Q3 <Report>", language: "en" },
    pages: [
      {
        pageNumber: 1,
        width: 600,
        height: 800,
        text: [heading, paragraph, first, second, tableHeader, tableRow, code]
          .map((value) => value.text)
          .join("\n"),
        lines: [heading, paragraph, first, second, tableHeader, tableRow, code],
        blocks: [
          { id: "heading", kind: "text", x: 20, y: 20, width: 220, height: 24, lines: [heading], role: "heading", level: 1 },
          { id: "paragraph", kind: "text", x: 20, y: 60, width: 260, height: 12, lines: [paragraph], role: "paragraph" },
          { id: "item-1", kind: "text", x: 20, y: 100, width: 80, height: 12, lines: [first], role: "list-item" },
          { id: "item-2", kind: "text", x: 20, y: 120, width: 80, height: 12, lines: [second], role: "list-item" },
          { id: "table", kind: "text", x: 20, y: 170, width: 200, height: 32, lines: [tableHeader, tableRow], role: "table" },
          { id: "code", kind: "text", x: 20, y: 240, width: 160, height: 12, lines: [code], role: "code" },
          { id: "figure", kind: "image", assetId: "figure", x: 20, y: 300, width: 40, height: 30, alt: "chart" },
        ],
        assets: [
          {
            id: "figure",
            pageNumber: 1,
            name: "chart.png",
            mimeType: "image/png",
            bytes: new Uint8Array([137, 80, 78, 71]),
            x: 20,
            y: 300,
            width: 40,
            height: 30,
          },
        ],
      },
      {
        pageNumber: 2,
        width: 600,
        height: 800,
        text: last.text,
        lines: [last],
        blocks: [
          { id: "last", kind: "text", x: 20, y: 30, width: 100, height: 12, lines: [last], role: "paragraph" },
        ],
      },
    ],
  };
}

export function block(text: string, y: number, role?: TextLayoutBlock["role"]): TextLayoutBlock {
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

export function listDocument(blocks: readonly TextLayoutBlock[]): LoadedDocument {
  const text = blocks.flatMap((item) => item.lines.map((line) => line.text)).join("\n");
  return {
    loader: "tagged-list-fixture",
    form: "digital",
    text,
    pages: [{ pageNumber: 1, width: 600, height: 800, text, blocks }],
  };
}

export function bySourceId(document: LayoutDocument, annotations: readonly LayoutAnnotation[]): LayoutAnnotation[] {
  const ids = new Map(document.pages.flatMap((page) =>
    page.elements.flatMap((element) => {
      const [source] = element.provenance.sourceIds;
      return source === undefined ? [] : [[source, element.id] as const];
    })));
  return annotations.map((annotation) => ({ ...annotation, id: ids.get(annotation.id) ?? annotation.id }));
}
