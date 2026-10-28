import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeInvoicePdf } from "../packages/docture/dist/testing/fixtures/index.js";

const image = process.argv[2];
assert.ok(image, "Pass a locally built image tag.");
const directory = await mkdtemp(join(tmpdir(), "docture-container-smoke-"));
const container = `docture-smoke-${process.pid}`;
const token = "local-container-smoke-token";
let created = false;

function docker(args, timeout = 30_000) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

try {
  await chmod(directory, 0o755);
  const fixture = await makeInvoicePdf({ seed: 12, lineItemCount: 3 });
  await writeFile(join(directory, "invoice.pdf"), fixture.bytes);
  await writeFile(join(directory, "docture.config.mjs"), `import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { jsonSchema } from "ai";
export default { loaders: [new DocumentLoaderPdfJs()], schema: jsonSchema({type:"object",properties:{text:{type:"string"}},required:["text"]}), strategies:[{name:"fixture-text",async extract(ctx){return {data:{text:ctx.document.text}};}}] };\n`);
  const cliScript = String.raw`
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { NapiCanvasRasterizer } from '/opt/docture/node_modules/docture/dist/raster/canvas/index.js';
import { silentLogger } from '/opt/docture/node_modules/docture/dist/index.js';
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const cli='/opt/docture/node_modules/@docture/cli/dist/bin.js';
const converted=spawnSync(process.execPath,[cli,'convert','/fixtures/invoice.pdf','--out','/tmp/converted','--to','txt','--no-config'],{encoding:'utf8'});
assert.equal(converted.status,0,converted.stderr);
const content=await readFile('/tmp/converted/invoice.txt','utf8'); assert.match(content,/INVOICE/i);
const inspected=spawnSync(process.execPath,[cli,'inspect','/fixtures/invoice.pdf','--format','json','--no-config'],{encoding:'utf8'});
assert.equal(inspected.status,0,inspected.stderr);
const rasterizer=new NapiCanvasRasterizer();
const pages=await rasterizer.rasterize({bytes:new Uint8Array(await readFile('/fixtures/invoice.pdf')),mimeType:'application/pdf'},{pages:[1],dpi:72},{signal:new AbortController().signal,logger:silentLogger}); assert.ok(pages[0].bytes.length>100); assert.deepEqual([...pages[0].bytes.slice(0,4)],[137,80,78,71]);
console.log(JSON.stringify({content,inspection:JSON.parse(inspected.stdout).results[0]}));
`;
  const cli = JSON.parse(docker(["run", "--rm", "--platform", "linux/amd64", "--mount", `type=bind,src=${directory},dst=/fixtures,readonly`, "--entrypoint", "node", image, "--input-type=module", "-e", cliScript], 90_000));
  created = true;
  docker(["run", "--detach", "--name", container, "--platform", "linux/amd64", "--publish", "127.0.0.1::8787", "--env", `DOCTURE_SERVE_TOKEN=${token}`, "--mount", `type=bind,src=${join(directory, "docture.config.mjs")},dst=/opt/docture/docture.config.mjs,readonly`, image, "serve", "--host", "0.0.0.0", "--port", "8787", "--config", "/opt/docture/docture.config.mjs"]);
  const bound = docker(["port", container, "8787/tcp"]);
  assert.match(bound, /^127\.0\.0\.1:\d+$/u);
  const url = `http://${bound}`;
  const input = { document: { data: Buffer.from(fixture.bytes).toString("base64"), mimeType: "application/pdf", fileName: "invoice.pdf" } };
  async function post(route, extra = {}) {
    const response = await fetch(`${url}/${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ ...input, ...extra }), signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.ok, true, JSON.stringify(result)); return result.results[0];
  }
  let conversion;
  let failure;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { conversion = await post("convert", { format: "text" }); break; }
    catch (error) { failure = error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.ok(conversion, String(failure));
  assert.equal(conversion.content, cli.content);
  const inspection = await post("inspect");
  assert.deepEqual(inspection.pages, cli.inspection.pages);
  const extraction = await post("extract", { schema: "default" });
  assert.equal(typeof extraction.data.text, "string");
  assert.match(extraction.data.text, /INVOICE/i);
  docker(["stop", "--time", "45", container], 60_000);
  assert.equal(docker(["inspect", "--format", "{{.State.ExitCode}}", container]), "0");
  console.log("Linux amd64 PDF.js/native-canvas conversion, HTTP parity and graceful SIGTERM shutdown passed.");
} finally {
  if (created) spawnSync("docker", ["rm", "--force", container], { encoding: "utf8", timeout: 10_000 });
  await rm(directory, { recursive: true, force: true });
}
