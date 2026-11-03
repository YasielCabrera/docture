import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type axe from "axe-core";
import { chromium, type Browser } from "playwright-core";
import migration from "../lib/docs-migration.json" with { type: "json" };

declare global {
  interface Window { axe: typeof axe }
}

const TEMPLATES = [
  "/", "/docs", "/docs/extraction/quick-start", "/docs/extraction/reference/extractor",
  "/docs/cli/commands/extract", "/docs/resources/troubleshooting",
  "/docs/getting-started/architecture", "/docs/api",
];
const MOBILE = new Set(["/", "/docs", "/docs/extraction/quick-start", "/docs/getting-started/architecture", "/docs/api"]);

async function freePort(): Promise<number> {
  const server = createServer().listen(0);
  await once(server, "listening");
  const address = server.address();
  server.close();
  if (address === null || typeof address !== "object") throw new Error("No free port");
  return address.port;
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [fileURLToPath(import.meta.resolve("next/dist/bin/next")), "start", "--port", String(port)], {
  stdio: ["ignore", "ignore", "inherit"],
});
const axeSource = await readFile(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");
const failures: string[] = [];
let scans = 0;
let legacyChecks = 0;
let browser: Browser | undefined;
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

try {
  browser = await chromium.launch();
  for (let attempt = 0; !(await fetch(`${origin}/docs`).then((response) => response.ok, () => false)); attempt += 1) {
    if (attempt === 100) throw new Error("next start did not answer within 30 seconds");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1280, 320]) {
      const page = await browser.newPage({ colorScheme, viewport: { width, height: 800 } });
      for (const path of TEMPLATES.filter((path) => width !== 320 || MOBILE.has(path))) {
        await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
        });
        await page.addScriptTag({ content: axeSource });
        const results = await page.evaluate(() => window.axe.run({
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
        }));
        for (const violation of results.violations) {
          const targets = violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? violation.help}`).join("; ");
          failures.push(`${path} (${colorScheme}, ${width}px): ${violation.id}, ${violation.nodes.length} element(s). ${targets}`);
        }
        scans += 1;
        check(await page.locator("main, [role=main]").count() === 1, `${path}: exactly one main landmark`);
        if (width === 320) check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path}: no page-level horizontal overflow`);
        if (path.startsWith("/docs")) {
          await page.keyboard.press("Tab");
          check(await page.locator(":focus").getAttribute("href") === "#nd-page", `${path}: the first Tab reaches the content bypass link`);
          await page.keyboard.press("Enter");
          check(await page.evaluate(() => document.activeElement?.id === "nd-page"), `${path}: bypass moves focus into the article`);
        }
        if (width === 320 && path === "/docs") {
          await page.getByRole("button", { name: "Open Sidebar" }).click();
          await page.locator("#nd-sidebar-mobile[data-state=open]").waitFor({ state: "visible" });
          const close = page.locator("#nd-sidebar-mobile").getByRole("button", { name: "Close Sidebar" });
          for (let attempt = 0; attempt < 10 && !(await close.evaluate((element) => element === document.activeElement)); attempt += 1) await page.keyboard.press("Tab");
          const focused = await close.evaluate((element) => element === document.activeElement);
          check(focused, "mobile navigation has a keyboard-reachable close control");
          if (focused) await page.keyboard.press("Enter");
          else await close.click();
          await page.locator("#nd-sidebar-mobile[data-state=open]").waitFor({ state: "hidden" });
        }
        if (path === "/docs/api") {
          const lookup = page.getByRole("region", { name: "API symbol lookup" });
          await lookup.getByRole("searchbox", { name: "Symbol or import path" }).fill("createCheckedExtractor");
          const target = lookup.getByRole("link", { name: "createCheckedExtractor", exact: true }).first();
          await target.waitFor();
          check(await target.getAttribute("href") === "/docs/extraction/reference/extractor#createcheckedextractor", "API filtering retains the exact symbol contract");
          await lookup.getByRole("combobox", { name: "Package" }).selectOption("@docture/synthetic");
          await lookup.getByRole("searchbox", { name: "Symbol or import path" }).fill("ENGINE_RANGES");
          check(await lookup.locator("tbody tr").count() === 6, "independent synthetic engine constants remain separate results");
          const llm = lookup.locator("tbody tr").filter({ hasText: "@docture/synthetic/llm" });
          check(await llm.getByRole("link", { name: "ENGINE_RANGES", exact: true }).getAttribute("href") === "/docs/synthetic/reference/text-generators#engine_ranges-1", "API package filtering keeps the LLM engine contract distinct from Faker");
        }
      }
      await page.close();
    }
  }
  const page = await browser.newPage();
  await page.goto(`${origin}/docs`);
  await page.getByRole("button", { name: /^Search|^Open Search/ }).first().click();
  await page.getByRole("textbox", { name: "Search" }).fill("PDF to Markdown");
  const guide = page.getByRole("dialog", { name: "Search" }).getByRole("button", { name: /Convert your first PDF/ }).first();
  await guide.waitFor();
  await guide.click();
  await page.waitForURL(`${origin}/docs/conversion/quick-start`);
  const oldTypes = "/docs/evaluation/reference/types";
  const representatives = new Map(Object.entries(migration[oldTypes].anchors).map(([anchor, target]) => [target.split("#")[0], { anchor, target }]));
  for (const { anchor, target } of representatives.values()) {
    const destination = new URL(target, origin);
    destination.search = "?verify=legacy";
    await page.goto(`${origin}${oldTypes}?verify=legacy#${anchor}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(destination.href, { waitUntil: "domcontentloaded" });
    check(await page.evaluate((fragment) => document.getElementById(fragment) !== null, destination.hash.slice(1)), `${oldTypes}#${anchor} preserves its query and reaches ${target}`);
    legacyChecks += 1;
  }
  await page.close();
} catch (error) {
  failures.push(`Browser interaction failed: ${String(error)}`);
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`Accessibility and interaction checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Accessibility and interaction checks passed: ${scans} light/dark desktop/mobile configurations, WCAG 2.2 AA and landmark rules, keyboard bypass, navigation, API filtering, search, and ${legacyChecks} legacy type destinations.`);
}
