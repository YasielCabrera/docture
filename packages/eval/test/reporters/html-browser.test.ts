import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { renderHtml } from "../../src/reporters/html/index.js";
import { savedResult } from "./fixture.js";
import { parseHtml } from "./html-dom.js";

const chrome = process.env["CHROME_BIN"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

it.skipIf(!existsSync(chrome))("runs the inline client under the offline CSP and supports document filtering and diffs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-csp-browser-"));
  try {
    const file = join(directory, "report.html");
    const source = savedResult();
    const html = renderHtml({ ...source, run: { ...source.run, status: "aborted" } });
    const exercise = `<script>
      const cases = document.querySelectorAll('tr.case');
      document.body.dataset.renderedCases = String(cases.length);
      cases[1].click();
      document.body.dataset.expandedDiffs = String(document.querySelectorAll('table.diffs').length);
      const search = document.querySelector('input[type=search]');
      search.value = 'c3';
      search.dispatchEvent(new Event('input'));
      document.body.dataset.filteredCases = String(document.querySelectorAll('tr.case').length);
    </script>`;
    await writeFile(file, html.replace("</body>", `${exercise}</body>`));
    const { stdout, stderr } = await promisify(execFile)(chrome, [
      "--headless", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${join(directory, "profile")}`, "--dump-dom", pathToFileURL(file).href,
    ], { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 });
    const page = await parseHtml(stdout);
    const body = page.elements.find((element) => element.name === "body");
    expect(page.text(page.elements.find((element) => element.name === "p" && element.attribs?.["class"] === "run")!)).toContain("aborted (incomplete)");
    expect(body?.attribs?.["data-rendered-cases"]).toBe("7");
    expect(body?.attribs?.["data-expanded-diffs"]).toBe("1");
    expect(body?.attribs?.["data-filtered-cases"]).toBe("2");
    expect(page.elements.filter((element) => element.attribs?.["class"]?.includes("verdict-regressed"))).toHaveLength(1);
    expect(page.elements.filter((element) => element.attribs?.["class"]?.includes("verdict-improved"))).toHaveLength(1);
    expect(stderr).not.toContain("Refused to execute inline script");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
