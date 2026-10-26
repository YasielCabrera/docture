import { decodeHTMLStrict } from "entities";
import { Parser } from "htmlparser2";
import { parse, type DefaultTreeAdapterTypes } from "parse5";

const HIDDEN = new Set(["head", "title", "script", "style", "template", "noscript"]);
const BLOCKS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
  "ul", "ol", "li", "table", "tr", "blockquote", "pre", "hr", "br",
]);

export function htmlText(source: string, syntax: "html" | "xhtml" = "html"): string {
  const parts: string[] = [];
  const rows = [0];
  let hidden = 0;
  const element = (rawName: string, closing: boolean): void => {
    const name = rawName.toLowerCase().split(":").at(-1) ?? rawName;
    if (HIDDEN.has(name)) {
      hidden += closing ? -1 : 1;
      return;
    }
    if (hidden > 0) return;
    const heading = /^h([1-6])$/.exec(name);
    if (heading !== null) {
      parts.push("\n");
      if (!closing) parts.push("#".repeat(Number(heading[1])) + " ");
    } else if (name === "td" || name === "th") {
      if (!closing) {
        const row = rows.length - 1;
        const cells = rows[row] ?? 0;
        if (cells > 0) parts.push("\t");
        rows[row] = cells + 1;
      }
    } else if (BLOCKS.has(name)) {
      parts.push("\n");
      if (name === "tr") {
        if (closing) rows.pop();
        else rows.push(0);
      }
      if (name === "li" && !closing) parts.push("- ");
    }
  };
  const text = (value: string): void => {
    if (hidden === 0) parts.push(value.replace(/\s+/g, " "));
  };

  if (syntax === "html") {
    const pending: { node: DefaultTreeAdapterTypes.Node; closing: boolean }[] = [
      { node: parse(source), closing: false },
    ];
    while (pending.length > 0) {
      const entry = pending.pop();
      if (entry === undefined) break;
      const { node, closing } = entry;
      if ("value" in node) {
        text(node.value);
      } else if (closing) {
        if ("tagName" in node) element(node.tagName, true);
      } else {
        if ("tagName" in node) {
          element(node.tagName, false);
          pending.push({ node, closing: true });
        }
        if ("childNodes" in node) {
          for (let index = node.childNodes.length - 1; index >= 0; index--) {
            const child = node.childNodes[index];
            if (child !== undefined) pending.push({ node: child, closing: false });
          }
        }
      }
    }
  } else {
    let cdata = false;
    new Parser({
      onopentag: (name) => element(name, false),
      onclosetag: (name) => element(name, true),
      ontext: (value) => text(cdata ? value : decodeHTMLStrict(value)),
      oncdatastart: () => { cdata = true; },
      oncdataend: () => { cdata = false; },
    }, { xmlMode: true, decodeEntities: false }).end(source);
  }

  return parts.join("").replace(/ *\t */g, "\t").replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n").trim();
}
