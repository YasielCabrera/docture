/**
 * The same library, from a terminal.
 *
 *     pnpm --filter @docture/examples cli
 *
 * Needs: `pnpm run fetch`. `inspect` needs no key. `extract` and `classify` need one unless
 * you point them at a config with deterministic strategies — which is what
 * `15-cli/docture.config.ts` does, and the most useful thing in this folder.
 *
 * This file RUNS the commands and shows you their output, so you can see what each one
 * is for before typing it. Three files next door are what the CLI actually needs from
 * you:
 *
 *   schema.ts            the shape you want           (--schema)
 *   kinds.ts             the candidate document kinds (--classifications)
 *   docture.config.ts    the wiring, when flags are not enough  (--config)
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { field, heading, note, step } from "../shared/print.js";
import { DOCUMENTS_DIR, idsOfKind, pathOf } from "../shared/documents.js";
import { isMain, optionalModel, requireDocument, run } from "../shared/run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
/** The CLI's own bin, run through tsx so it uses workspace source rather than a build. */
const BIN = resolve(ROOT, "node_modules/@docture/cli/src/bin.ts");

/** Run `docture ...` and echo both the command and what it printed. */
async function cli(
  args: readonly string[],
  { quiet = false, expectedExit = 0, stdin }: { quiet?: boolean; expectedExit?: number; stdin?: { shown: string; bytes: Uint8Array } } = {},
): Promise<void> {
  const shown = ["docture", ...args.map((a) => relative(ROOT, a) === a ? a : relative(ROOT, a))];
  console.log(`\n  $ ${stdin === undefined ? "" : `${stdin.shown} | `}${shown.join(" ")}\n`);

  await new Promise<void>((done, reject) => {
    const child = spawn(resolve(ROOT, "node_modules/.bin/tsx"), [BIN, ...args], {
      cwd: ROOT,
      stdio: [stdin === undefined ? "ignore" : "pipe", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
    });
    child.stdin?.end(stdin?.bytes);
    let captured = "";
    child.stdout?.on("data", (chunk: Buffer) => (captured += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (captured += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const succeeded = code === expectedExit;
      if (quiet) {
        // Just the head, so a long report does not bury the next command.
        const lines = captured.trimEnd().split("\n");
        const shown = succeeded ? lines.slice(0, 14) : lines;
        for (const line of shown) console.log(`  ${line}`);
        if (shown.length < lines.length) console.log(`  … ${lines.length - shown.length} more lines`);
      }
      if (!succeeded) {
        reject(new Error(`docture ${args[0]} exited with ${signal ?? code}; expected ${expectedExit}`));
        return;
      }
      done();
    });
  });
}

async function main(): Promise<void> {
  await requireDocument("invoice-odoo");

  heading("The command line");

  // ── 1. inspect ────────────────────────────────────────────────────────────────

  step("1. inspect — what do the loaders actually see?");

  note(
    "The answer to “why did no strategy run?”. Loads the document exactly as `extract`\n" +
      "would and prints the features eligibility is decided from. No model, no API key.",
  );

  await cli(["inspect", pathOf("invoice-odoo")], { quiet: true });

  /**
   * The same command on the page image is the one worth remembering: it is how you find
   * out that the default PDF loader cannot accept an image. Exit 1 is expected here.
   */
  await cli(["inspect", pathOf("scan-services")], { quiet: true, expectedExit: 1 });

  // ── 2. inspect, across the corpus ─────────────────────────────────────────────

  step("2. inspect --format json, across everything");

  note(
    "`--format json` makes it pipeable, which is where a CLI earns its place. This is the\n" +
      "one-liner for “which of these 4,000 documents are scans?”:\n\n" +
      "  docture inspect documents/*.pdf --format json | jq -r '.results[] | select(.ok and .features.form==\"scanned\") | .file'",
  );

  await cli(["inspect", ...idsOfKind("invoice").slice(0, 4).map((id) => pathOf(id)), "--format", "json"], {
    quiet: true,
  });

  // ── 3. extract, with a config and no model ────────────────────────────────────

  step("3. extract — with a config, and no model at all");

  note(
    "`15-cli/docture.config.ts` wires the deterministic parsers from `shared/parsers/`.\n" +
      "So this extracts a real invoice from the command line, for free, with no API key —\n" +
      "the CLI is a shell over the same API, not a lesser interface with its own ideas.",
  );

  const config = resolve(HERE, "docture.config.ts");
  await cli(["extract", pathOf("invoice-odoo"), "--config", config], { quiet: true });

  step("4. --full, when the answer is not the whole question");

  note("Adds method, loader, attempts, usage and features to each envelope result item.");

  await cli(["extract", pathOf("invoice-services"), "--config", config, "--full"], { quiet: true });

  // ── 5. classify ───────────────────────────────────────────────────────────────

  step("5. classify — decide, without paying to extract");

  await cli(
    ["classify", pathOf("invoice-odoo"), pathOf("statement"), "--config", config],
    { quiet: true },
  );

  step("6. - reads the document from stdin");

  note("For a pipe: `curl … | docture extract - …`. The result is labelled `stdin`.");

  await cli(["inspect", "-", "--format", "json", "--no-config"], {
    quiet: true,
    stdin: { shown: `cat ${relative(ROOT, pathOf("invoice-odoo"))}`, bytes: await readFile(pathOf("invoice-odoo")) },
  });

  step("7. --dry-run — check the invocation, read nothing");

  note(
    "Resolves the config, schema, inputs, outputs and wiring, prints the plan as JSON and\n" +
      "stops. No document is loaded and no output directory is created.",
  );

  await cli(["extract", pathOf("invoice-odoo"), "--config", config, "-o", "out/", "--dry-run"], { quiet: true });

  step("8. help --json — the flags, for an agent");

  await cli(["help", "convert", "--json"], { quiet: true });

  step("9. mcp — convert and inspect as MCP tools");

  note(
    "`docture mcp` speaks JSON-RPC on stdin and stdout. An agent host starts it from its\n" +
      'config: { "mcpServers": { "docture": { "command": "npx", "args": ["docture", "mcp"] } } }.\n' +
      "Here three frames are piped in by hand; the server answers and stops at end of input.",
  );

  const frames = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tour", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  await cli(["mcp", "--no-config"], {
    quiet: true,
    stdin: { shown: "initialize, tools/list", bytes: new TextEncoder().encode(frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n") },
  });

  step("10. review — see the boxes over the page");

  note(
    "`docture review` writes one offline HTML file: each page as an image, with every\n" +
      "element's box drawn over it. Open it in a browser and hover a box for its id and kind.\n" +
      "With --schema and --model it extracts with citations instead, and selecting a field\n" +
      "highlights the lines it cites. A saved result works too:\n\n" +
      "  docture review --conversion report.json --source report.pdf\n" +
      "  docture review --extraction result.json --source invoice.pdf --item 0",
  );

  const review = join(await mkdtemp(join(tmpdir(), "docture-review-")), "review.html");
  await cli(["review", pathOf("invoice-odoo"), "--no-config", "-o", review], { quiet: true });

  step("11. the flags worth knowing");

  const rows: readonly (readonly [string, string])[] = [
    ["--schema ./schema.ts", "the shape you want. `#Invoice` picks one export"],
    ["--classifications ./kinds.ts", "the candidate document kinds"],
    ["--config ./docture.config.ts", "wiring, when flags are not enough"],
    ["--model openai/gpt-5", "a gateway id, or a provider instance in the config"],
    ["--vision --dpi 200", "render pages and show them to the model"],
    ["--completion paginate", "one request per page — example 08"],
    ["--only odoo-invoice-parser", "pin the run to one strategy — example 06"],
    ["--pricing ./pricing.json", "turn tokens into a cost — example 07"],
    ["--cache .cache/docture", "pay once for the same request — example 07"],
    ["--concurrency 8", "documents in flight at once — example 12"],
    ["--format ndjson", "one line per document, as each finishes"],
    ["-o out/", "a file, or a directory when there are several inputs"],
    ["--min-f1 0.95", "on `eval`: exit 1 below this, so CI can gate on it"],
    ["--dry-run", "print the plan as JSON; read and write nothing"],
  ];
  for (const [flag, what] of rows) console.log(`  ${flag.padEnd(30)} ${what}`);

  step("12. eval — score a corpus from the command line");

  note(
    "`docture eval` extracts each document, scores it field by field against a truth\n" +
      "file and prints the same Markdown scoreboard example 12 prints, then exits 1 if\n" +
      "`--min-f1` is not met. That is accuracy as a CI gate:\n\n" +
      "  docture eval documents/*.pdf --schema ./schema.ts \\\n" +
      "    --truth documents/ --min-f1 0.95\n\n" +
      "The truth-completeness trap from example 12 applies here in full: a partial answer\n" +
      "key will report hallucinations that are not hallucinations.",
  );

  field("documents available", `${DOCUMENTS_DIR}`);
  field("model configured", optionalModel() === undefined ? "no — inspect and the config still work" : "yes");

  console.log("\n  Run `docture --help`, or `docture extract --help`, for the full list.");
  console.log("\n  That is the tour. Back to the top: apps/examples/README.md");
}

if (isMain(import.meta.url)) await run(main);
