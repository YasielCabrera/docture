import type { DocumentElement, LayoutPage } from "../domain/conversion.js";
import { sha256Hex } from "./sha256.js";

type IdentifiedElement = Exclude<DocumentElement, { kind: "page-break" }>;

const SCHEME_VERSION = 1;

const normalize = (text: string): string => text.normalize("NFC").replace(/\s+/gu, " ").trim();

function identityOf(element: IdentifiedElement): readonly [string, unknown] {
  switch (element.kind) {
    case "heading":
    case "paragraph":
    case "code":
    case "page-header":
    case "page-footer":
      return ["text", normalize(element.text)];
    case "list":
      return ["list", [element.ordered, element.items.map((item) => normalize(item.text))]];
    case "table":
      return ["table", element.rows.map((row) => row.map(normalize))];
    case "figure":
      return ["figure", [
        normalize(element.alt ?? ""),
        normalize(element.caption ?? ""),
        Math.round(element.provenance.box.width),
        Math.round(element.provenance.box.height),
      ]];
    default: {
      const unreachable: never = element;
      return unreachable;
    }
  }
}

function baseId(element: IdentifiedElement): string {
  const { pageNumber, box } = element.provenance;
  const [identityClass, content] = identityOf(element);
  const key = JSON.stringify([SCHEME_VERSION, identityClass, pageNumber, Math.round(box.x), Math.round(box.y), content]);
  return `p${pageNumber}-${sha256Hex(key).slice(0, 12)}`;
}

export function withElementIds(pages: readonly LayoutPage[]): LayoutPage[] {
  const seen = new Map<string, number>();
  return pages.map((page) => ({
    ...page,
    elements: page.elements.map((element) => {
      if (element.kind === "page-break") return element;
      const base = baseId(element);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return { ...element, id: count === 1 ? base : `${base}-${count}` };
    }),
  }));
}
