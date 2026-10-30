export const PAGE_TYPES = ["overview", "tutorial", "how-to", "explanation", "reference", "troubleshooting"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export interface DocPage {
  readonly route: string;
  readonly source: string;
}

const SECTIONED_PROSE_WORDS = 150;

export function frontmatterField(source: string, field: string): string | undefined {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
  const value = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(frontmatter)?.[1]?.trim();
  return value?.replace(/^(["'])(.*)\1$/, "$2");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[`*_]/g, "").replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function proseWords(source: string): number {
  return source
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\|.*$/gm, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

function isReference(route: string): boolean {
  return /\/(reference|commands)(\/|$)/.test(route) || route === "/docs/api";
}

export function checkSections({ route, source }: DocPage): string[] {
  if (isReference(route)) return [];
  const failures: string[] = [];
  const title = slug(frontmatterField(source, "title") ?? "");
  const sections = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? "");
  for (const section of sections) {
    if (slug(section) === title) failures.push(`${route}: the section "${section}" repeats the page title; name the task it covers`);
  }
  const words = proseWords(source);
  if (words > SECTIONED_PROSE_WORDS && sections.length < 2) {
    failures.push(`${route}: ${words} words of prose need at least two H2 sections so readers and search can reach each task`);
  }
  return failures;
}

export function checkOpening({ route, source }: DocPage): string[] {
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\s*(?:import .*\n|\{\/\*.*\*\/\}\n|\s*\n)*/, "");
  if (/^#{2,6} /.test(body)) return [`${route}: open with a sentence that says what the page is for, before the first heading`];
  return [];
}

export function checkOutboundLinks({ route, source }: DocPage): string[] {
  if (/\]\(\/docs[^)]*\)|href=["']\/docs/.test(source)) return [];
  return [`${route}: link at least one related page so a reader arriving from search can go on`];
}

export function checkPageType({ route, source }: DocPage): string[] {
  const type = frontmatterField(source, "type");
  if (type === undefined) return [`${route}: add a type to the frontmatter (${PAGE_TYPES.join(", ")})`];
  if (!(PAGE_TYPES as readonly string[]).includes(type)) return [`${route}: unknown page type ${type}`];
  const expected: PageType | undefined = isReference(route) ? "reference"
    : route === "/docs" || /^\/docs\/(getting-started|extraction|conversion|evaluation|synthetic|cli|integrations|resources)$/.test(route) ? "overview"
    : route.endsWith("/quick-start") ? "tutorial"
    : undefined;
  if (expected !== undefined && type !== expected) return [`${route}: pages at this location have type ${expected}, not ${type}`];
  if (type === "tutorial" && !/^## Next steps$/m.test(source)) return [`${route}: tutorials end with a "Next steps" section`];
  return [];
}

const ACRONYMS: Readonly<Record<string, string>> = {
  Api: "API", Cli: "CLI", Csv: "CSV", Html: "HTML", Http: "HTTP", Json: "JSON", Junit: "JUnit",
  Llm: "LLM", Mcp: "MCP", Ocr: "OCR", Pdf: "PDF", Url: "URL", Xml: "XML",
};
const ACRONYM = new RegExp(`(?<![\\w./-])(${Object.keys(ACRONYMS).join("|")})(?![\\w-])`, "gi");
const CORRECT = new Map(Object.entries(ACRONYMS).map(([miscased, correct]) => [miscased.toLowerCase(), correct]));

export function checkMetadata(pages: readonly DocPage[]): string[] {
  const failures: string[] = [];
  const byDescription = new Map<string, string[]>();
  for (const { route, source } of pages) {
    const title = frontmatterField(source, "title") ?? "";
    const description = frontmatterField(source, "description") ?? "";
    if (/^Public (API|interfaces) for\b/i.test(description)) failures.push(`${route}: replace the generic description with the job this page covers`);
    for (const [field, value] of [["title", title], ["description", description]] as const) {
      if (route.startsWith("/docs/cli/commands/")) continue;
      for (const [acronym] of value.replace(/`[^`]*`/g, "").matchAll(ACRONYM)) {
        const correct = CORRECT.get(acronym.toLowerCase());
        if (acronym !== correct) failures.push(`${route}: write ${correct} instead of ${acronym} in the ${field}`);
      }
    }
    byDescription.set(description, [...byDescription.get(description) ?? [], route]);
  }
  for (const [description, routes] of byDescription) {
    if (routes.length > 1) failures.push(`${routes.join(", ")}: pages share the description "${description}"`);
  }
  return failures;
}

export function checkInboundLinks(pages: readonly DocPage[]): string[] {
  const linked = new Set<string>();
  for (const { route, source } of pages) {
    for (const match of source.matchAll(/(?:\]\(|href=["'])(\/docs[^)#"'\s?]*)/g)) {
      const target = (match[1] ?? "").replace(/\/$/, "");
      if (target !== route) linked.add(target);
    }
  }
  return pages
    .filter(({ route }) => route !== "/docs" && !linked.has(route))
    .map(({ route }) => `${route}: no other page links here; link it from its area introduction or a related guide`);
}

const PORTABLE_IMPORT = /import\s*\{[^}]*\b(?:Extractor|DocumentConverter|Process|createExtractor|createDocumentConverter|createCheckedExtractor)\b[^}]*\}\s*from\s*["']docture["']/;
const NODE_IMPORT = /from\s*["']docture\/node["']/;
const LOCAL_PATH_CALL = /\.(?:extract|convert|classify|split|process|inspect|load)\(\s*["'`](?![a-z]+:\/\/)([^"'`\s]+\.(?:pdf|png|jpe?g|tiff?|eml|docx|txt|html?))["'`]/;

export function checkPortableLocalPaths(text: string): string[] {
  const blocks = /```/.test(text) ? [...text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)].map((match) => match[1] ?? "") : [text];
  return blocks.flatMap((block) => {
    const path = LOCAL_PATH_CALL.exec(block)?.[1];
    if (path === undefined || !PORTABLE_IMPORT.test(block) || NODE_IMPORT.test(block)) return [];
    return [`passes the local path ${path} to a constructor imported from docture; import it from docture/node or pass bytes`];
  });
}

export function versionedInstallSpecs(text: string): string[] {
  const commands = [
    ...[...text.matchAll(/\b(?:npm (?:install|i)|pnpm add|yarn add)\b[^`"\n]*/g)].map((match) => match[0]),
    ...[...text.matchAll(/```package-install\n([\s\S]*?)```/g)].map((match) => match[1] ?? ""),
  ];
  return commands.flatMap((command) => [...command.matchAll(/(?<![\w@/-])'?(?:@[\w.-]+\/)?[\w.-]+@[^\s'`]+/g)].map((match) => match[0]));
}

export function countInstallCommands(text: string): number {
  return [...text.matchAll(/\b(?:npm (?:install|i)|pnpm add|yarn add)\b|```package-install\n/g)].length;
}
