import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));

it("runs the quick start from the repository root using its adjacent PDF", async () => {
  const script = fileURLToPath(new URL("../quick-start/index.ts", import.meta.url));
  const { stdout } = await execute(process.execPath, [tsx, script], { cwd: root });
  const output: unknown = JSON.parse(stdout);
  expect(output).toEqual({
    data: { invoiceNumber: "INV-2026-0142", total: 717.3 },
    method: "supply-invoice",
    loader: "pdfjs",
  });
});

it("runs the CLI example through the installed command and local configuration", async () => {
  const script = fileURLToPath(new URL("../cli/index.ts", import.meta.url));
  const { stdout } = await execute(process.execPath, [tsx, script], { cwd: root });
  const output: unknown = JSON.parse(stdout);
  expect(output).toEqual({
    version: 1, command: "extract", ok: true,
    results: [{ file: "invoice.pdf", ok: true, data: { invoiceNumber: "INV-2026-0142", total: 717.3 } }],
  });
});

it("fails with a setup error when a model example has no credentials", async () => {
  const script = fileURLToPath(new URL("../with-a-model/index.ts", import.meta.url));
  await expect(execute(process.execPath, [tsx, script], {
    cwd: root,
    env: { ...process.env, AI_GATEWAY_API_KEY: "" },
  })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Set AI_GATEWAY_API_KEY") });
});
