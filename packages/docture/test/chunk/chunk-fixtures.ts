import type { LoadedDocument } from "../../src/core/index.js";
import { line, span } from "../core/conversion-fixtures.js";

export function headingsDocument(): LoadedDocument {
  const items = [
    [100, "Annual report", 1],
    [140, "Revenue grew.", undefined],
    [180, "Costs", 2],
    [210, "Costs were flat.", undefined],
  ] as const;
  const lines = items.map(([y, value]) => line(y, [span(value, 40, y, { style: { fontSize: 11 } })]));
  return {
    loader: "chunk-fixture",
    form: "digital",
    text: lines.map((item) => item.text).join("\n"),
    pages: [{
      pageNumber: 1,
      width: 600,
      height: 800,
      text: lines.map((item) => item.text).join("\n"),
      lines,
      blocks: lines.map((item, index) => {
        const level = items[index]?.[2];
        return {
          id: `p1-text-${index + 1}`, kind: "text" as const, x: 40, y: item.y, width: 100, height: 12, lines: [item],
          ...(level === undefined ? {} : { role: "heading" as const, level }),
        };
      }),
    }],
  };
}
