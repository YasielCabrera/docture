import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { summary } from "../lib/eval-evidence.js";

const run = promisify(execFile);
const examplesRoot = resolve("examples");
const directory = await mkdtemp(join(tmpdir(), "docture-docs-examples-"));
const loader = import.meta.resolve("tsx");

async function example(file: string, cwd = directory): Promise<string> {
  // tsx compiles JSX with the tsconfig it finds from the working directory; the temporary one has none.
  const { stdout } = await run(process.execPath, ["--import", loader, join(examplesRoot, file)], {
    cwd,
    env: { ...process.env, TSX_TSCONFIG_PATH: resolve("tsconfig.json") },
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
  assert.equal(await example("conversion-sample-pdf.ts"), `Wrote report.pdf for invoice ${fixture.expected.invoiceNumber}`);
  await example("document-conversion.ts");
  const markdown = await readFile(join(directory, "converted/report.md"), "utf8");
  assert.ok(markdown.includes(fixture.expected.invoiceNumber), "converted Markdown contains the invoice number");
  assert.ok(markdown.includes("<!-- page: 1 -->"), "converted Markdown preserves its page marker");

  assert.equal(await example("synthetic-corpus.ts"), summary, "the home page shows the synthetic-corpus output");
  assert.equal(await example("react-invoice.tsx"), "2 pages, 126 labels verified");
  assert.match(await example("rag-chunks.ts"), /^chunk-[0-9a-f]{16} page 1 box [\d.]+,[\d.]+,[\d.]+,[\d.]+$/mu);

  const quickStart = join(directory, "quick-start");
  await mkdir(quickStart);
  assert.equal(await example("quick-start/make-invoice.ts", quickStart), "Wrote invoice.pdf, 1 page");
  assert.equal(
    await example("quick-start/extract.ts", quickStart),
    "{\n  invoiceNumber: 'INV-2026-4311',\n  issuedAt: '2026-02-01',\n  total: 10768.68\n}\nread-labels used 0 model tokens",
    "the extraction quick start prints the output shown on its page",
  );

  const loop = join(directory, "loop");
  await mkdir(loop);
  assert.equal(await example("loop/invoice.ts", loop), "");
  assert.equal(await example("loop/model.ts", loop), "");
  assert.equal(await example("loop/extractor.ts", loop), "");
  assert.equal(
    await example("loop/generate.ts", loop),
    "3 digital cases ready in corpus/manifest.jsonl",
  );
  assert.equal(
    await example("loop/extract.ts", loop),
    "INV-102: 2979 cents, 0 model tokens\nINV-102: 3491 cents, 0 model tokens\nINV-101: 9970 cents, 0 model tokens",
  );
  assert.equal(
    await example("loop/evaluate.ts", loop),
    "3/3 cases scored\nF1: 1\nError rate: 0",
  );
  assert.equal(
    await example("loop/gate.ts", loop),
    "PASS: f1 for experiment read-labels is 1\nPASS: errorRate for experiment read-labels is 0\nGate passed",
  );
  assert.equal(
    await example("loop/generate-scans.ts", loop),
    "6 digital and scan cases ready in corpus/manifest.jsonl",
  );
  assert.equal(
    await example("loop/evaluate.ts", loop),
    "3/6 cases scored\nF1: 0.6666666666666666\nError rate: 0.5",
  );
  await assert.rejects(example("loop/gate.ts", loop), {
    code: 1,
    stdout: "FAIL: f1 for experiment read-labels is 0.6667, below the minimum 1\nFAIL: errorRate for experiment read-labels is 0.5, above the maximum 0\nGate failed\n",
  });

  console.log("Documentation examples passed: twelve offline recipes and the extract, generate, and evaluate loop with its failing scan gate.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
