import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { makeInvoicePdf } from "docture/testing/fixtures";

const run = promisify(execFile);
const examplesRoot = resolve("examples");
const directory = await mkdtemp(join(tmpdir(), "docture-docs-examples-"));
const loader = import.meta.resolve("tsx");

async function example(file: string): Promise<string> {
  const { stdout } = await run(process.execPath, ["--import", loader, join(examplesRoot, file)], {
    cwd: directory,
    timeout: 30_000,
  });
  return stdout.trim();
}

try {
  const fixture = await makeInvoicePdf({ seed: 301, lineItemCount: 12 });
  await writeFile(join(directory, "invoice.pdf"), fixture.bytes);
  await writeFile(join(directory, "report.pdf"), fixture.bytes);

  assert.equal(await example("custom-components.ts"), "120.5");
  assert.equal(await example("sources-and-inputs.ts"), "INV-1");
  assert.equal(await example("measure-accuracy.ts"), "1\n[]");
  assert.equal(await example("check-conversion.ts"), "4/4 conversion checks passed");
  assert.equal(await example("deterministic-invoice.ts"), `${fixture.expected.total} invoice-parser`);
  await example("document-conversion.ts");
  const markdown = await readFile(join(directory, "converted/report.md"), "utf8");
  assert.ok(markdown.includes(fixture.expected.invoiceNumber), "converted Markdown contains the invoice number");
  assert.ok(markdown.includes("<!-- page: 1 -->"), "converted Markdown preserves its page marker");

  assert.match(await example("rag-chunks.ts"), /^chunk-[0-9a-f]{16} page 1 box [\d.]+,[\d.]+,[\d.]+,[\d.]+$/mu);

  console.log("Documentation examples passed: seven offline recipes executed with generated PDFs.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
