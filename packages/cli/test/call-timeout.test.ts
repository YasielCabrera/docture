import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { INVOICE_JSON_SCHEMA, cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

it.each([
  ["extract", "invoice.pdf"],
  ["convert", "invoice.pdf", "--out", "converted"],
  ["classify", "invoice.pdf"],
  ["inspect", "invoice.pdf"],
  ["review", "invoice.pdf", "--out", "review.html"],
  ["eval", "invoice.pdf"],
])("validates --timeout before loading configuration for %s", async (...args) => {
  const dir = await tempDir("invalid-call-timeout");
  await writeFixture(dir, "docture.config.mjs", 'throw new Error("configuration must not load");');
  for (const dryRun of args[0] === "inspect" ? [false] : [false, true]) {
    const run = await cli([...args, "--timeout", "not-a-number", ...(dryRun ? ["--dry-run"] : [])], { cwd: dir });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--timeout expects a number");
    expect(run.stderr).not.toContain("configuration must not load");
  }
});

it("--timeout bounds each document's whole call, across strategies that each finish within it", async () => {
  const dir = await tempDir("call-timeout");
  const slow = (name: string) => `{
    name: ${JSON.stringify(name)},
    async extract(ctx) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      ctx.signal.throwIfAborted();
      throw new Error("not this one");
    },
  }`;
  await writeFixture(dir, "docture.config.mjs", textLoaderConfig(["Invoice INV-1 total 42"], `${slow("first")}, ${slow("second")}`));
  await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
  await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

  const run = await cli(["extract", "invoice.pdf", "-s", "./invoice.schema.json", "--timeout", "100", "--format", "json"], { cwd: dir });

  expect(run.code).toBe(1);
  expect(JSON.parse(run.stdout).results[0]).toMatchObject({
    file: "invoice.pdf",
    ok: false,
    error: { code: "TIMEOUT", message: '"call" exceeded its 100ms deadline.' },
  });
});

const SLOW_LOADER = (ms: number, image = 0) => `{
  name: "slow",
  capabilities: { text: true, geometry: true, images: ${image > 0}, mimeTypes: ["*/*"] },
  async load(_raw, ctx) {
    await new Promise((resolve) => setTimeout(resolve, ${ms}));
    ctx.signal.throwIfAborted();
    const text = "Invoice INV-1 total 42";
    const line = { y: 80, height: 12, text, spans: [{ text, x: 40, y: 80, width: 120, height: 12, style: { fontSize: 11 } }] };
    const png = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    const image = async () => { await new Promise((resolve) => setTimeout(resolve, ${image})); return png; };
    return { pages: [{ pageNumber: 1, width: 600, height: 800, text, lines: [line], ${image > 0 ? "image" : ""} }], text, form: "digital", loader: "slow" };
  },
}`;
const PNG_SOURCE = `const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAICAYAAADaxo44AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVAiZY/z///9/BiyACZvg4JUAABofBAymvql2AAAAAElFTkSuQmCC";`;

it("review accepts a deadline beyond the longest Node timer", async () => {
  const dir = await tempDir("review-long-timeout");
  await writeFixture(dir, "docture.config.mjs", `${PNG_SOURCE}\nexport default { loaders: [${SLOW_LOADER(20, 1)}] };`);
  await writeFixture(dir, "report.pdf", "%PDF-1.7 pretend");
  const run = await cli(["review", "report.pdf", "--out", "review.html", "--timeout", "3000000000"], { cwd: dir });
  expect(run.code, run.stderr).toBe(0);
});

it("review includes the source download in its document deadline", async () => {
  const server = createServer((_request, response) => {
    const timer = setTimeout(() => response.end("%PDF-1.7 pretend"), 300);
    response.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected an HTTP port");
    const dir = await tempDir("review-download-timeout");
    await writeFixture(dir, "docture.config.mjs", `${PNG_SOURCE}\nexport default { loaders: [${SLOW_LOADER(0, 1)}] };`);
    const run = await cli(["review", `http://127.0.0.1:${address.port}/report.pdf`, "--out", "review.html", "--timeout", "100"], { cwd: dir });
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain('"call" exceeded its 100ms deadline.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

it("--timeout bounds a call to an extractor the config supplies already built", async () => {
  const dir = await tempDir("call-timeout-extractor");
  await writeFixture(dir, "docture.config.mjs", `import { createExtractor } from "docture/node";
${PNG_SOURCE}
export default {
  extractor: createExtractor({
    loaders: [${SLOW_LOADER(0)}],
    strategies: [{ name: "slow", async extract(ctx) { await new Promise((resolve) => setTimeout(resolve, 400)); ctx.signal.throwIfAborted(); return { data: { invoiceId: "INV-1", total: 42 } }; } }],
  }),
};`);
  await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
  await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

  const run = await cli(["extract", "invoice.pdf", "-s", "./invoice.schema.json", "--timeout", "100", "--format", "json"], { cwd: dir });

  expect(run.code).toBe(1);
  expect(JSON.parse(run.stdout).results[0]).toMatchObject({ ok: false, error: { code: "TIMEOUT", message: '"call" exceeded its 100ms deadline.' } });
});

it("--timeout bounds a conversion by a converter the config supplies already built", async () => {
  const dir = await tempDir("call-timeout-converter");
  await writeFixture(dir, "docture.config.mjs", `import { createDocumentConverter } from "docture/node";
${PNG_SOURCE}
export default { converter: createDocumentConverter({ loaders: [${SLOW_LOADER(400)}] }) };`);
  await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

  const run = await cli(["convert", "invoice.pdf", "--out", "out", "--to", "text", "--timeout", "100", "--format", "json"], { cwd: dir });

  expect(run.code).toBe(1);
  expect(JSON.parse(run.stdout).results[0]).toMatchObject({ ok: false, error: { code: "TIMEOUT", message: '"call" exceeded its 100ms deadline.' } });
});

it("review --timeout bounds the whole document, its conversion and its page rendering together", async () => {
  const dir = await tempDir("call-timeout-review");
  await writeFixture(dir, "docture.config.mjs", `${PNG_SOURCE}
export default { loaders: [${SLOW_LOADER(150, 5000)}] };`);
  await writeFixture(dir, "report.pdf", "%PDF-1.7 pretend");

  const started = Date.now();
  const run = await cli(["review", "report.pdf", "-o", "review.html", "--timeout", "400"], { cwd: dir });

  expect([run.code, run.stderr.split("\n")[0]]).toEqual([1, 'error [TIMEOUT] "call" exceeded its 400ms deadline.']);
  expect(Date.now() - started).toBeLessThan(3000);
});

it("exits once its output is flushed, without waiting for work abandoned at the deadline", async () => {
  const dir = await tempDir("call-timeout-exit");
  await writeFixture(dir, "docture.config.mjs", `let calls = 0;
export default {
  loaders: [${SLOW_LOADER(0)}],
  strategies: [{
    name: "stubborn",
    async extract() {
      if (calls++ === 0) return { data: { a: "x".repeat(300000) } };
      await new Promise((resolve) => setTimeout(resolve, 8000));
      return { data: { a: "late" } };
    },
  }],
};
${PNG_SOURCE}`);
  await writeFixture(dir, "s.json", JSON.stringify({ type: "object", properties: { a: { type: "string" } } }));
  await writeFixture(dir, "a.pdf", "%PDF-1.7 pretend");
  await writeFixture(dir, "b.pdf", "%PDF-1.7 pretend");

  const tsx = createRequire(new URL("../../../apps/docs/package.json", import.meta.url)).resolve("tsx/esm");
  const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
  const started = Date.now();
  const child = spawn(process.execPath, ["--conditions=source", "--import", tsx, bin, "extract", "a.pdf", "b.pdf", "-s", "./s.json", "--concurrency", "1", "--timeout", "300", "--format", "json"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  const exit = await new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const elapsed = Date.now() - started;

  const results = JSON.parse(stdout).results as { file: string; ok: boolean; data?: { a: string }; error?: { code: string } }[];
  expect(results.map((result) => [result.file, result.ok, result.data?.a.length ?? result.error?.code])).toEqual([["a.pdf", true, 300000], ["b.pdf", false, "TIMEOUT"]]);
  expect(exit).toBe(1);
  expect(elapsed).toBeLessThan(6000);
}, 20_000);
