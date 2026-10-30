import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import migration from "../lib/docs-migration.json" with { type: "json" };

const SEARCHES: ReadonlyArray<readonly [query: string, page: string]> = [
  ["PDF.js password", "/docs/integrations/pdfjs"],
  ["createExtr", "/docs/extraction/reference"],
  ["createExtractor", "/docs/extraction/reference"],
  ["MissingEngineError", "/docs/resources/errors"],
  ["docture convert", "/docs/cli"],
  ["UNSUPPORTED_SOURCE", "/docs/resources/errors"],
  ["scanned PDF OCR", "/docs/integrations"],
  ["ground truth dataset", "/docs/evaluation"],
  ["synthetic corpus", "/docs/synthetic"],
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
  for (const page of pages) {
    const html = await get(page);
    check(html.status === 200, `${page} answers ${html.status}`);
    const body = await html.text();
    for (const match of body.matchAll(/href="(\/docs[^"#?]*)/g)) linked.add(match[1] ?? "");
    const edit = /href="https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/(apps\/docs\/content\/docs\/[^"]+\.mdx)"/.exec(body)?.[1];
    check(edit !== undefined && existsSync(`../../${edit}`), `${page} links "Edit on GitHub" to its source file (${edit})`);
    const markdown = await get(`${page}.md`);
    const text = await markdown.text();
    check(markdown.status === 200 && text.startsWith("# "), `${page}.md serves Markdown`);
    check(!/<CodeBlockTabs|<Cards|\{\/\*|\[#[\w-]+\]$/m.test(text), `${page}.md contains no component tags or anchor suffixes`);
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
  const sitemap = await get("/sitemap.xml");
  const locations = [...(await sitemap.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1] ?? "");
  check(sitemap.status === 200 && locations.every((location) => /^https?:\/\//.test(location)), `sitemap.xml lists only absolute URLs (${locations.length} entries)`);
  check((await get("/robots.txt")).status === 200, "robots.txt exists");

  for (const [query, page] of SEARCHES) {
    const results = await (await get(`/api/search?query=${encodeURIComponent(query)}`)).json() as Array<{ url: string }>;
    const top = [...new Set(results.map((result) => result.url.split("#")[0] ?? ""))].slice(0, 5);
    check(top.some((url) => url === page || url.startsWith(`${page}/`)), `search "${query}" finds ${page} in the top results (got ${top.slice(0, 3).join(", ")})`);
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
