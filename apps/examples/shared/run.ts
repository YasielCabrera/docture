/**
 * Running an example: entry points, and the two things an example can be missing.
 *
 * A missing download and a missing API key are not failures — they are "you have not
 * done the setup step yet". Both raise {@link ExampleSkipped}, which {@link run} turns
 * into a bordered block naming the exact command to fix it, and an exit code of 0.
 * Anything else is a real error and exits 1.
 */

import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { LLM } from "docture/llm";
import { documentOf, pathOf } from "./documents.js";

/** A setup step the reader has not run yet. Not a failure. */
export class ExampleSkipped extends Error {
  constructor(
    readonly title: string,
    readonly detail: string,
  ) {
    super(title);
    this.name = "ExampleSkipped";
  }
}

/**
 * True when this module was the one node was pointed at.
 *
 * Each example guards its `main` with this so it stays a plain entrypoint you can run,
 * while the test can import its contracts and parsers without executing it. The test
 * then checks the code you actually read rather than a copy of it.
 */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && moduleUrl === pathToFileURL(entry).href;
}

function block(title: string, detail: string): string {
  const width = 76;
  const wrapped: string[] = [];
  for (const paragraph of detail.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line !== "" && `${line} ${word}`.length > width - 4) {
        wrapped.push(line);
        line = word;
      } else {
        line = line === "" ? word : `${line} ${word}`;
      }
    }
    wrapped.push(line);
  }
  return [
    `\n┌${"─".repeat(width - 2)}┐`,
    `│ ${title.padEnd(width - 4)} │`,
    `├${"─".repeat(width - 2)}┤`,
    ...wrapped.map((line) => `│ ${line.padEnd(width - 4)} │`),
    `└${"─".repeat(width - 2)}┘`,
  ].join("\n");
}

/** Run an example, and fail like a tool rather than like a crash. */
export async function run(example: () => Promise<void>): Promise<void> {
  try {
    await example();
  } catch (error) {
    if (error instanceof ExampleSkipped) {
      console.log(block(`SKIPPED — ${error.title}`, error.detail));
      // Deliberately 0. Not having run the setup step is not a broken example.
      return;
    }
    console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// ── The two setup steps ─────────────────────────────────────────────────────────

/** The path to a sample document, or a skip explaining how to get it. */
export async function requireDocument(id: string): Promise<string> {
  const path = pathOf(id);
  try {
    await access(path);
  } catch {
    throw new ExampleSkipped(
      `the sample document "${id}" has not been downloaded`,
      `This example reads ${documentOf(id).file}, which is gitignored because the repo ` +
        `should not carry documents it does not own.\n\n` +
        `Run this once:\n  pnpm --filter @docture/examples run fetch`,
    );
  }
  return path;
}

/**
 * Several at once, so an example skips before it prints half a table.
 *
 * The return type is a TUPLE of the same length as the arguments, not `string[]`. That
 * matters at every call site: destructuring a `string[]` gives `string | undefined` under
 * `noUncheckedIndexedAccess`, and every example would need a non-null assertion it should
 * not have to write.
 */
export async function requireDocuments<const T extends readonly string[]>(
  ...ids: T
): Promise<{ [K in keyof T]: string }> {
  const paths: string[] = [];
  for (const id of ids) paths.push(await requireDocument(id));
  return paths as { [K in keyof T]: string };
}

const MODEL_ID = process.env["DOCTURE_MODEL"] ?? "openai/gpt-5";

/**
 * The model, or a skip.
 *
 * A plain model id string is routed through the Vercel AI Gateway, so no provider
 * package is needed. For a provider instance instead, `pnpm add @ai-sdk/openai` and
 * pass `openai("gpt-5")` to `new LLM(...)` — example 07 shows both.
 */
export function requireModel(options?: ConstructorParameters<typeof LLM>[1]): LLM {
  const model = optionalModel(options);
  if (model === undefined) {
    throw new ExampleSkipped(
      "this example needs a model, and AI_GATEWAY_API_KEY is not set",
      `Everything here runs against a real model — there is no mock, because a mock ` +
        `would teach you the wiring and lie about the answer.\n\n` +
        `Run it with:\n  AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples <script>\n\n` +
        `Set DOCTURE_MODEL to use something other than ${MODEL_ID}.`,
    );
  }
  return model;
}

/**
 * The model if there is one, `undefined` otherwise.
 *
 * For examples whose deterministic half is worth running on its own — the fallback
 * chain in 06 is the main one, where "no model configured" is itself a rung worth
 * seeing reported.
 */
export function optionalModel(options?: ConstructorParameters<typeof LLM>[1]): LLM | undefined {
  if (process.env["AI_GATEWAY_API_KEY"] === undefined) return undefined;
  return new LLM(MODEL_ID, {
    // Extraction should be reproducible, and these documents have one reading.
    temperature: 0,
    ...options,
  });
}

/** The configured model id, for printing. */
export const MODEL_NAME = MODEL_ID;

/** True when the reader asked for OCR. It downloads models on first run. */
export function ocrEnabled(): boolean {
  const flag = process.env["RUN_OCR"];
  return flag === "1" || flag === "true";
}
