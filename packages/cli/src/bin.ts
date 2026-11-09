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

/** Resolves once every chunk written before it has left the process, even into a slow pipe. */
function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}

const argv = process.argv.slice(2);
try {
  const code = await run(argv, { io, signal: controller.signal });
  process.exitCode = interrupted && code !== 0 ? EXIT_INTERRUPTED : code;
} catch (error) {
  // `run` handles its own errors; anything arriving here is a bug in the CLI, and
  // a stack trace is the right thing to show for one.
  io.diagnostic(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}

// A deadline abandons work that ignores its signal, and that work can hold the event
// loop open long after the result is out. A one-shot command exits once its output
// has drained; `mcp` and `serve` return only after they have shut down.
if (argv[0] !== "mcp" && argv[0] !== "serve") {
  await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
  process.exit();
}
