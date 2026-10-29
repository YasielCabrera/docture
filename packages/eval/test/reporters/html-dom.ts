import { parseDocument, DomUtils } from "htmlparser2";

/** The parts of a domhandler node the tests read. */
export type DomNode = ReturnType<typeof DomUtils.findAll>[number];

/** Parse HTML the way a browser tokenizer does and return every element plus a text reader. */
export async function parseHtml(
  html: string,
): Promise<{ elements: DomNode[]; byId: (id: string) => DomNode | undefined; text: (node: DomNode) => string }> {
  const document = parseDocument(html);
  const elements = DomUtils.findAll(() => true, document.children ?? []);
  return {
    elements,
    byId: (id: string): DomNode | undefined => elements.find((node) => node.attribs?.["id"] === id),
    text: (node: DomNode): string => DomUtils.textContent(node),
  };
}
