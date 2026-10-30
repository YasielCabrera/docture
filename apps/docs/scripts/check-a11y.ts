import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type { AxeResults } from "axe-core";
import { chromium } from "playwright-core";

const TEMPLATES = [
  "/",
  "/docs",
  "/docs/extraction/quick-start",
  "/docs/extraction/reference/extractor",
  "/docs/cli/commands/extract",
  "/docs/resources/troubleshooting",
];

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
const browser = await chromium.launch();
const failures: string[] = [];

try {
  for (let attempt = 0; !(await fetch(`${origin}/docs`).then((response) => response.ok, () => false)); attempt += 1) {
    if (attempt === 100) throw new Error("next start did not answer within 30 seconds");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  for (const colorScheme of ["light", "dark"] as const) {
    const page = await browser.newPage({ colorScheme });
    for (const path of TEMPLATES) {
      await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
      await page.addScriptTag({ content: axeSource });
      const results = await page.evaluate(() => (window as unknown as { axe: { run: (options: object) => Promise<AxeResults> } }).axe.run({
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      }));
      for (const violation of results.violations) {
        const contrasts = new Set(violation.nodes.flatMap((node) => {
          const data = node.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
          return data?.contrastRatio === undefined ? [] : [`${data.fgColor} on ${data.bgColor} is ${data.contrastRatio}`];
        }));
        const targets = contrasts.size > 0 ? [...contrasts].join("; ") : violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join("; ");
        failures.push(`${path} (${colorScheme}): ${violation.id}, ${violation.nodes.length} element(s): ${violation.help}. ${targets}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`Accessibility checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Accessibility checks passed: ${TEMPLATES.length} templates in light and dark mode against WCAG 2.1 AA rules.`);
}
