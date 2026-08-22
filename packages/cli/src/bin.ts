#!/usr/bin/env node
/**
 * The executable. Everything it does is connect a process to {@link run}.
 *
 * Ctrl-C aborts the run rather than killing the process outright: core checks the
 * signal before every stage, so an interrupted batch stops between documents with
 * its components disposed, instead of leaving a WASM engine or a worker behind.
 * A second Ctrl-C is the impatient one, and that does exit immediately.
 */

import { processIo } from "./cli/io.js";
import { EXIT_INTERRUPTED } from "./cli/errors.js";
import { run } from "./run.js";

const io = processIo();
const controller = new AbortController();
let interrupted = false;

process.on("SIGINT", () => {
  if (interrupted) process.exit(EXIT_INTERRUPTED);
  interrupted = true;
  io.diagnostic("\nInterrupted — finishing the current stage. Ctrl-C again to force.\n");
  controller.abort();
});

// `process.exitCode` rather than `process.exit`: stdout may still be draining into
// a pipe, and exiting outright truncates it.
try {
  const code = await run(process.argv.slice(2), { io, signal: controller.signal });
  process.exitCode = interrupted && code !== 0 ? EXIT_INTERRUPTED : code;
} catch (error) {
  // `run` handles its own errors; anything arriving here is a bug in the CLI, and
  // a stack trace is the right thing to show for one.
  io.diagnostic(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
