/**
 * @docture/cli — the command line, and the pieces it is made of.
 *
 * ```sh
 * npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
 * ```
 *
 * The library export exists for two reasons: `defineConfig`, which a
 * `docture.config.ts` imports, and `run`, which is the entire CLI as a function of
 * argv and an {@link Io} — so a wrapper, a test, or a task runner can drive it
 * without spawning a process.
 */

export { run } from "./run.js";
export type { RunOptions } from "./run.js";

export { defineConfig } from "./config.js";
export type { DoctureConfig } from "./config.js";

export { captureIo, processIo, styleFor } from "./cli/io.js";
export type { CapturedIo, Io, Style } from "./cli/io.js";

export { CliError, UsageError, explain } from "./cli/errors.js";
export type { ExitCode, Explained } from "./cli/errors.js";

export { version } from "./version.js";
