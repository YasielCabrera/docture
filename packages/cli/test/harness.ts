/**
 * Test scaffolding: a scratch directory, a file writer, and the CLI as a call.
 *
 * The scratch directories live under `test/.tmp/` rather than the OS temp dir on
 * purpose. A config or schema written there is imported by the code under test,
 * and module resolution from inside the package is what a real user's project
 * looks like — `zod` resolves, and so does anything else in the workspace.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureIo, run, type ExitCode } from "../src/index.js";

const ROOT = fileURLToPath(new URL("./.tmp/", import.meta.url));

const created: string[] = [];
let counter = 0;

/** A fresh directory. Unique per call: an `import()` caches by path, forever. */
export async function tempDir(name: string): Promise<string> {
  const dir = join(ROOT, `${name}-${process.pid}-${counter++}`);
  await mkdir(dir, { recursive: true });
  created.push(dir);
  return dir;
}

/** Removes only what this test file made, so parallel workers cannot collide. */
export async function cleanup(): Promise<void> {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
}

export async function writeFixture(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

export interface CliRun {
  readonly code: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

export async function cli(
  argv: readonly string[],
  options: { readonly cwd: string; readonly env?: Readonly<Record<string, string | undefined>> },
): Promise<CliRun> {
  const io = captureIo({ cwd: options.cwd, env: options.env ?? {}, color: false });
  const code = await run(argv, { io });
  return { code, stdout: io.stdout, stderr: io.stderr };
}

/**
 * A config with no imports at all.
 *
 * The plugin contracts are structural — `defineLoader` and `defineStrategy` are
 * identity functions — so a test double is an object literal. Which also means
 * these fixtures prove the structural claim, not just exercise the CLI.
 */
export function fixedStrategyConfig(data: unknown, options: { name?: string } = {}): string {
  return `export default {
  strategies: [
    {
      name: ${JSON.stringify(options.name ?? "fixed")},
      async extract(ctx) {
        ctx.signal.throwIfAborted();
        return { data: ${JSON.stringify(data)} };
      },
    },
  ],
};
`;
}

/** A loader that answers with fixed page text, for tests that need no real PDF. */
export function textLoaderConfig(pages: readonly string[], strategy: string): string {
  return `const pages = ${JSON.stringify(pages)}.map((text, i) => ({
  pageNumber: i + 1,
  width: 595,
  height: 842,
  text,
  lines: text.split("\\n").map((line, n) => ({
    y: 50 + n * 14,
    height: 11,
    text: line,
    spans: [{ text: line, x: 50, y: 50 + n * 14, width: line.length * 6, height: 11 }],
  })),
}));

export default {
  loaders: [
    {
      name: "fake",
      capabilities: { text: true, geometry: true, images: false, mimeTypes: ["*/*"] },
      async load(_raw, ctx) {
        ctx.signal.throwIfAborted();
        return { pages, text: pages.map((p) => p.text).join("\\f"), form: "digital", loader: "fake" };
      },
    },
  ],
  strategies: [${strategy}],
};
`;
}

export const INVOICE_JSON_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      invoiceNumber: { type: "string" },
      total: { type: "number" },
    },
    required: ["invoiceNumber", "total"],
    additionalProperties: false,
  },
  null,
  2,
);
