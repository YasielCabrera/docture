import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { remark } from "remark";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { expect, it } from "vitest";
import { expandSourceExamples } from "../lib/example-source";

it("runs the copied model example with its documented files and a deterministic provider response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docture-copied-model-"));
  try {
    const page = await readFile(resolve("content/docs/extraction/with-a-model.mdx"), "utf8");
    const markdown = await expandSourceExamples(page);
    const files = new Map<string, string>();
    for (const node of remark().parse(markdown).children) {
      if (node.type !== "code") continue;
      const name = /^title="([^"]+)"$/.exec(node.meta ?? "")?.[1];
      if (name !== undefined) files.set(name, node.value);
    }
    for (const name of ["package.json", "invoice.ts", "extract-invoice.mts"]) {
      const content = files.get(name);
      assert.ok(content !== undefined, `the copied page must supply ${name}`);
      await writeFile(join(directory, name), content);
    }
    await symlink(resolve("node_modules"), join(directory, "node_modules"), "dir");
    const fixture = await makeInvoicePdf({ seed: 301 });
    await writeFile(join(directory, "invoice.pdf"), fixture.bytes);
    const data = { invoiceNumber: fixture.expected.invoiceNumber, issuedAt: "2026-02-09", total: fixture.expected.total, lineItems: [] };
    const response = { id: "resp_docs", model: "gpt-5", output: [{ type: "message", id: "msg_docs", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(data), annotations: [] }] }], usage: { input_tokens: 12, output_tokens: 24 } };
    const mock = join(directory, "mock-provider.mjs");
    await writeFile(mock, `import assert from "node:assert/strict";
let calls = 0;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), "https://api.openai.com/v1/responses");
  assert.ok(init.body.includes(${JSON.stringify(fixture.expected.invoiceNumber)}));
  calls++;
  return Response.json(${JSON.stringify(response)});
};
process.on("exit", () => assert.equal(calls, 1));
`);
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", pathToFileURL(mock).href, "--import", import.meta.resolve("tsx"), "extract-invoice.mts"], {
      cwd: directory, env: { ...process.env, OPENAI_API_KEY: "documentation-test-only" }, timeout: 30_000,
    });
    expect(stdout).toContain(fixture.expected.invoiceNumber);
    expect(stdout).toContain(String(fixture.expected.total));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
