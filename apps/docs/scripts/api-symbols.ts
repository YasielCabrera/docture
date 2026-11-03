import type { ApiEntrypointInventory } from "../api-reference.js";
import type { ApiSymbolRecord } from "../lib/api-symbol-markdown.js";

interface Heading {
  readonly line: number;
  readonly depth: number;
  readonly title: string;
  readonly anchor: string;
}

function plainText(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*~]/g, "").replace(/<[^>]+>/g, "").trim();
}

export function headingSlug(value: string): string {
  return plainText(value).toLowerCase().replace(/[^\p{Letter}\p{Number}\s_-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}

export function pageRoute(path: string): string {
  const part = path.replace(/^content\/docs\//, "").replace(/\.mdx$/, "");
  return part === "index" ? "/docs" : `/docs/${part.replace(/\/index$/, "")}`;
}

function headingsOf(source: string): Heading[] {
  const counts = new Map<string, number>();
  const headings: Heading[] = [];
  let fence: string | undefined;
  for (const [line, text] of source.split("\n").entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (delimiter !== undefined) {
      if (fence === undefined) fence = delimiter;
      else if (delimiter.startsWith(fence) && text.trim() === delimiter) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const marker = /^#{2,6}(?=\s)/.exec(text)?.[0];
    if (marker === undefined) continue;
    const title = text.slice(marker.length).trim();
    const base = headingSlug(title);
    if (base === "") continue;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    headings.push({ line, depth: marker.length, title, anchor: count === 0 ? base : `${base}-${count}` });
  }
  return headings;
}

function exactSymbolHeading(title: string, symbol: string): boolean {
  return plainText(title) === symbol || [...title.matchAll(/`([^`]+)`/g)].some((match) => match[1] === symbol);
}

function symbolHeading(headings: readonly Heading[], symbol: string, importPath?: string): Heading | undefined {
  const matching = headings.filter((heading) => exactSymbolHeading(heading.title, symbol));
  const explicit = matching.filter((heading) => plainText(heading.title) === symbol && heading.title.includes(`\`${symbol}\``));
  const candidates = explicit.length > 0 ? explicit : matching;
  if (candidates.length < 2) return candidates[0];
  const section = headings.find((heading) => plainText(heading.title) === importPath);
  if (section !== undefined) {
    const end = headings.find((heading) => heading.line > section.line && heading.depth <= section.depth)?.line ?? Infinity;
    const scoped = candidates.filter((heading) => heading.line > section.line && heading.line < end);
    if (scoped.length === 1) return scoped[0];
  }
  throw new Error(`${symbol} has ambiguous reference headings for ${importPath ?? "an unspecified import"}`);
}

function descriptionOf(source: string, heading: Heading | undefined): string {
  const fallback = /^description:\s*(.+)$/m.exec(source)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  if (heading === undefined) return fallback;
  const lines = source.split("\n").slice(heading.line + 1);
  const paragraph: string[] = [];
  for (const line of lines) {
    if (/^#{2,6}\s|^\s*```|^\s*~~~|^\|/.test(line)) break;
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^\s*(?:import\b|<|\{\/\*)/.test(line)) continue;
    paragraph.push(line.trim());
  }
  const description = plainText(paragraph.join(" ")) || fallback;
  return description.length <= 240 ? description : `${description.slice(0, 237).replace(/\s+\S*$/, "")}...`;
}

export function symbolReference(
  path: string,
  symbol: string,
  pages: ReadonlyMap<string, string>,
  importPath?: string,
): Pick<ApiSymbolRecord, "url" | "description"> {
  const source = pages.get(path);
  if (source === undefined) throw new Error(`Missing API reference page: ${path}`);
  const headings = headingsOf(source);
  const exact = symbolHeading(headings, symbol, importPath);
  if (exact !== undefined) return { url: `${pageRoute(path)}#${exact.anchor}`, description: descriptionOf(source, exact) };

  for (const link of source.matchAll(/\[([^\]]+)\]\((\/docs[^)\s]+)\)/g)) {
    if (plainText(link[1] ?? "") !== symbol) continue;
    const route = (link[2] ?? "").split("#", 1)[0];
    const target = [...pages].find(([page]) => pageRoute(page) === route);
    if (target === undefined) continue;
    const heading = symbolHeading(headingsOf(target[1]), symbol, importPath);
    if (heading !== undefined) return { url: `${route}#${heading.anchor}`, description: descriptionOf(target[1], heading) };
  }

  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occurrence = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
  const typeName = new RegExp(`^${escaped}(?:<.*>)?$`);
  const candidates: Array<{ line: number; priority: number }> = [];
  let importing = false;
  let fence: string | undefined;
  for (const [line, text] of source.split("\n").entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (delimiter !== undefined) {
      if (fence === undefined) fence = delimiter;
      else if (delimiter.startsWith(fence) && text.trim() === delimiter) {
        fence = undefined;
        importing = false;
      }
      continue;
    }
    if (/^\s*import\s/.test(text)) importing = true;
    if (importing) {
      if (/\bfrom\s*["']|^\s*import\s*["']/.test(text)) importing = false;
      continue;
    }
    if (!occurrence.test(text)) continue;
    const declaration = new RegExp(`\\b(?:type|interface|class|function|const|enum)\\s+${escaped}(?![A-Za-z0-9_$])`).test(text);
    const marker = new RegExp(`^\\s*\\{\\/\\*\\s*options:\\s*${escaped}\\s*\\*\\/\\}\\s*$`).test(text);
    const named = [...text.matchAll(/`([^`]+)`/g)].some((match) => occurrence.test(match[1] ?? ""));
    const firstColumn = text.startsWith("|") ? text.slice(1).split(/(?<!\\)\|/, 1)[0] ?? "" : "";
    const definition = [...firstColumn.matchAll(/`([^`]+)`/g)].some((match) => typeName.test((match[1] ?? "").trim()));
    if (declaration || marker || named || fence !== undefined) candidates.push({ line,
      priority: declaration ? 0 : marker || definition ? 1 : text.startsWith("|") ? 2 : fence === undefined ? 3 : 4 });
  }
  const selected = candidates.sort((a, b) => a.priority - b.priority || a.line - b.line)[0];
  if (selected === undefined) throw new Error(`${path}: ${symbol} needs a documented contract outside an import`);
  const heading = headings.findLast((candidate) => candidate.line <= selected.line);
  return { url: pageRoute(path) + (heading === undefined ? "" : `#${heading.anchor}`), description: descriptionOf(source, heading) };
}

export function apiSymbols(inventory: readonly ApiEntrypointInventory[], pages: ReadonlyMap<string, string>): ApiSymbolRecord[] {
  const records = new Map<string, ApiSymbolRecord>();
  for (const item of inventory) {
    for (const [page, symbols] of Object.entries(item.pages)) {
      for (const symbol of symbols) {
        const reference = symbolReference(page, symbol, pages, item.importPath);
        const key = `${item.packageName}\0${symbol}\0${reference.url}`;
        const previous = records.get(key);
        records.set(key, {
          packageName: item.packageName,
          symbol,
          importPaths: [...new Set([...(previous?.importPaths ?? []), item.importPath])].sort(),
          ...reference,
        });
      }
    }
  }
  return [...records.values()].sort((a, b) => a.packageName.localeCompare(b.packageName) || a.symbol.localeCompare(b.symbol) || a.url.localeCompare(b.url));
}
