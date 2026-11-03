import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import migration from "../lib/docs-migration.json" with { type: "json" };
import { z } from "zod";

const SEARCHES: ReadonlyArray<readonly [query: string, page: string]> = [
  ["PDF.js password", "/docs/integrations/pdfjs"],
  ["createExtr", "/docs/extraction/reference/extractor"],
  ["createExtractor", "/docs/extraction/reference/extractor"],
  ["createCheckedExtractor", "/docs/extraction/reference/extractor"],
  ["MissingEngineError", "/docs/resources/errors"],
  ["docture convert", "/docs/cli/commands/convert"],
  ["UNSUPPORTED_SOURCE", "/docs/resources/errors"],
  ["scanned PDF OCR", "/docs/integrations/scanned-documents"],
  ["ground truth dataset", "/docs/evaluation/datasets"],
  ["synthetic corpus", "/docs/synthetic/corpora"],
  ["PDF to Markdown", "/docs/conversion/quick-start"],
  ["turn a PDF into Markdown", "/docs/conversion/quick-start"],
  ["read a scanned PDF", "/docs/integrations/scanned-documents"],
  ["extract invoice fields", "/docs/extraction/quick-start"],
  ["Node.js version", "/docs/getting-started/runtime"],
  ["supported Node runtime", "/docs/getting-started/runtime"],
  ["run an evaluation", "/docs/evaluation/quick-start"],
  ["generate a labeled PDF", "/docs/synthetic/quick-start"],
  ["configure model credentials", "/docs/extraction/with-a-model"],
  ["evaluate a custom processor", "/docs/evaluation/processors"],
  ["make Markdown from a PDF file", "/docs/conversion/quick-start"],
  ["OCR an image-only document", "/docs/integrations/scanned-documents"],
  ["get JSON fields out of an invoice", "/docs/extraction/quick-start"],
  ["evaluate my own extraction function", "/docs/evaluation/processors"],
  ["build a dataset of synthetic invoices", "/docs/synthetic/corpora"],
  ["recover from a missing optional engine", "/docs/resources/troubleshooting"],
];

async function freePort(): Promise<number> {
  const server = createServer().listen(0);
  await once(server, "listening");
  const address = server.address();
  server.close();
  assert.ok(address !== null && typeof address === "object");
  return address.port;
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [fileURLToPath(import.meta.resolve("next/dist/bin/next")), "start", "--port", String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, SITE_URL: origin },
});

async function get(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, origin), { redirect: "manual", ...init });
}

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

try {
  for (let attempt = 0; ; attempt += 1) {
    if (await get("/docs").then((response) => response.ok, () => false)) break;
    if (attempt === 100) throw new Error("next start did not answer within 30 seconds");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const index = await (await get("/llms.txt")).text();
  check(index.startsWith("# docture\n\n> "), "llms.txt starts with the project name and a summary");
  const markdownPages = [...index.matchAll(/\]\((?:https?:\/\/[^/)]+)?(\/docs[^)]*\.md)\)/g)].map((match) => match[1] ?? "");
  check(markdownPages.length > 200, `llms.txt lists every page (found ${markdownPages.length})`);

  const areaExports = [...index.matchAll(/\]\((?:https?:\/\/[^/)]+)?(\/llms-full\/[\w-]+\.txt)\)/g)].map((match) => match[1] ?? "");
  check(areaExports.length === 8, `llms.txt links one full export per area (found ${areaExports.length})`);
  for (const path of areaExports) {
    const text = await (await get(path)).text();
    check(text.startsWith("# ") && text.length < 250_000, `${path} serves a Markdown export under 250 KB (${text.length} bytes)`);
  }

  const pages = markdownPages.map((path) => path.replace(/\.md$/, ""));
  const linked = new Set<string>();
  const rendered = new Map<string, string>();
  for (const page of pages) {
    const html = await get(page);
    check(html.status === 200, `${page} answers ${html.status}`);
    const body = await html.text();
    rendered.set(page, body);
    check(/<article[^>]*role="main"|<main\b/.test(body), `${page} has a main landmark`);
    const metadataLinks = body.match(/<link\b[^>]*>/g) ?? [];
    check(metadataLinks.some((link) => {
      const href = /href="([^"]+)"/.exec(link)?.[1];
      return link.includes('rel="alternate"') && link.includes('type="text/markdown"') && href !== undefined
        && new URL(href, origin).pathname === `${page}.md`;
    }), `${page} advertises its own Markdown alternative`);
    check(metadataLinks.some((link) => link.includes('rel="describedby"') && link.includes('href="/llms.txt"')), `${page} advertises the documentation index`);
    for (const match of body.matchAll(/href="(\/docs[^"#?]*)/g)) linked.add(match[1] ?? "");
    const edit = /href="https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/(apps\/docs\/content\/docs\/[^"]+\.mdx)"/.exec(body)?.[1];
    check(edit !== undefined && existsSync(`../../${edit}`), `${page} links "Edit on GitHub" to its source file (${edit})`);
    const markdown = await get(`${page}.md`);
    const text = await markdown.text();
    check(markdown.status === 200 && text.startsWith("# "), `${page}.md serves Markdown`);
    check(!/<CodeBlockTabs|<Cards|\{\/\*|\[#[\w-]+\]$/m.test(text), `${page}.md contains no component tags or anchor suffixes`);
    check(!/^<Mermaid\b|^<ApiIndex\b/m.test(text), `${page}.md expands diagrams and symbol lookup`);
    check(/Page type: [\w-]+\. Source revision: .+\./.test(text), `${page}.md identifies its type and revision`);
  }
  for (const href of linked) {
    const status = (await get(href)).status;
    check([200, 307, 308].includes(status), `rendered link ${href} answers ${status}`);
  }

  for (const route of Object.keys(migration)) {
    const status = (await get(route)).status;
    check([200, 307, 308].includes(status), `legacy route ${route} answers ${status}`);
  }

  const negotiated = await get("/docs/extraction/quick-start", { headers: { accept: "text/markdown" } });
  check(negotiated.headers.get("content-type")?.startsWith("text/markdown") === true, "Accept: text/markdown returns Markdown");
  check((negotiated.headers.get("vary") ?? "").toLowerCase().split(/\s*,\s*/).includes("accept"), "negotiated Markdown varies caches by Accept");
  check(await negotiated.text() === await (await get("/docs/extraction/quick-start.md")).text(), "negotiated and direct Markdown have identical content");
  const sitemap = await get("/sitemap.xml");
  const locations = [...(await sitemap.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1] ?? "");
  check(sitemap.status === 200 && locations.length === pages.length + 1 && locations.every((location) => /^https?:\/\//.test(location)), `sitemap.xml lists all canonical pages with absolute URLs (${locations.length} entries)`);
  check(JSON.stringify(locations.map((location) => new URL(location).pathname).sort()) === JSON.stringify(["/", ...pages].sort()), "sitemap.xml excludes legacy and Markdown routes and includes every canonical page");
  check((await get("/robots.txt")).status === 200, "robots.txt exists");

  const tasks = await (await get("/llms-tasks.txt")).text();
  check(tasks.includes("/docs/extraction/quick-start.md") && tasks.includes("/docs/evaluation/quick-start.md"), "task index links executable starting points");
  for (const path of areaExports) {
    const areaIndex = await get(path.replace("/llms-full/", "/llms/"));
    check(areaIndex.ok && (await areaIndex.text()).includes(".md)"), `${path} has a scoped discovery index`);
  }
  const symbols = z.array(z.object({ symbol: z.string(), importPaths: z.array(z.string()).min(1), url: z.string(), description: z.string() })).parse(await (await get("/api-symbols.json")).json());
  for (const symbol of symbols) {
    const [path, fragment] = symbol.url.split("#", 2);
    const body = path === undefined ? undefined : rendered.get(path);
    check(body !== undefined && (fragment === undefined || body.includes(`id="${fragment}"`)), `symbol ${symbol.symbol} points to a rendered contract ${symbol.url}`);
  }

  for (const [query, page] of SEARCHES) {
    const results = z.array(z.object({ url: z.string(), id: z.string(), type: z.enum(["page", "heading", "text"]), breadcrumbs: z.array(z.string()).optional() }))
      .parse(await (await get(`/api/search?query=${encodeURIComponent(query)}`)).json());
    let parent: string | undefined;
    for (const result of results) {
      if (result.type === "page") {
        parent = result.url;
        check(result.breadcrumbs !== undefined, `search "${query}" retains breadcrumb context for ${result.url}`);
      } else check(result.url.split("#")[0] === parent, `search "${query}" keeps ${result.url} under its parent page`);
    }
    check(new Set(results.map((result) => result.id)).size === results.length, `search "${query}" has unique interactive result IDs`);
    const top = [...new Set(results.map((result) => result.url.split("#")[0] ?? ""))].slice(0, 3);
    check(top.includes(page), `search "${query}" finds ${page} in the top three pages (got ${top.join(", ")})`);
  }

  if (failures.length > 0) {
    console.error(`Site smoke checks failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Site smoke checks passed: ${pages.length} pages and their Markdown, ${linked.size} rendered links, ${Object.keys(migration).length} legacy routes, ${SEARCHES.length} searches.`);
  }
} finally {
  server.kill();
}
