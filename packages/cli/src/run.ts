/**
 * The dispatcher.
 *
 * `run` is the whole CLI as a function: argv in, exit code out, every side effect
 * through the {@link Io} it was handed. `bin.ts` is the twenty lines that connect
 * it to a process, and the tests drive this directly — which is why they are fast
 * and why they assert on exactly what a user would see.
 */

import { boolFlag, nearest, parseCommand, type Parsed } from "./cli/args.js";
import { explain, exitCodeOf, UsageError, type ExitCode } from "./cli/errors.js";
import { commandHelp, topLevelHelp } from "./cli/help.js";
import { styleFor, type Io } from "./cli/io.js";
import { COMMANDS, findCommand } from "./cli/specs.js";
import { version } from "./version.js";

type Handler = (parsed: Parsed, io: Io, signal: AbortSignal) => Promise<ExitCode>;

const HANDLERS: Readonly<Record<string, () => Promise<Handler>>> = {
  extract: async () => (await import("./commands/extract.js")).extractCommand,
  convert: async () => (await import("./commands/convert.js")).convertCommand,
  classify: async () => (await import("./commands/classify.js")).classifyCommand,
  inspect: async () => (await import("./commands/inspect.js")).inspectCommand,
  eval: async () => (await import("./commands/eval.js")).evalCommand,
};

function suggestCommand(name: string): string | undefined {
  return nearest(name, COMMANDS.map((c) => c.name));
}

export interface RunOptions {
  readonly io: Io;
  /** Aborting stops the pipeline between stages; `bin.ts` wires it to SIGINT. */
  readonly signal?: AbortSignal;
}

export async function run(argv: readonly string[], options: RunOptions): Promise<ExitCode> {
  const supplied = options.io;
  const io: Io = {
    cwd: supplied.cwd,
    env: supplied.env,
    write: (chunk) => supplied.write(chunk),
    diagnostic: (chunk) => supplied.diagnostic(chunk),
    color: supplied.color && supplied.env["NO_COLOR"] === undefined,
    stdoutColor: supplied.stdoutColor && supplied.env["NO_COLOR"] === undefined,
  };
  const signal = options.signal ?? new AbortController().signal;
  const color = io.color && !argv.includes("--no-color") && io.env["NO_COLOR"] === undefined;
  const stdoutStyle = styleFor(io.stdoutColor && !argv.includes("--no-color") && io.env["NO_COLOR"] === undefined);

  const [first, ...rest] = argv;

  if (first === undefined || first === "--help" || first === "-h") {
    io.write(topLevelHelp(stdoutStyle, version()));
    return 0;
  }
  if (first === "--version" || first === "-V") {
    io.write(`${version()}\n`);
    return 0;
  }
  // `docture help extract` is the same request as `docture extract --help`.
  if (first === "help") {
    const target = rest[0] === undefined ? undefined : findCommand(rest[0]);
    io.write(target === undefined ? topLevelHelp(stdoutStyle, version()) : commandHelp(target, stdoutStyle));
    return 0;
  }

  const spec = findCommand(first);
  if (spec === undefined) {
    const near = suggestCommand(first);
    return report(
      new UsageError(
        first.startsWith("-")
          ? `Unknown option "${first}" — the first argument must be a command.`
          : `Unknown command "${first}".`,
        near === undefined
          ? `Commands: ${COMMANDS.map((c) => c.name).join(", ")}.`
          : `Did you mean \`docture ${near}\`?`,
      ),
      io,
      color,
    );
  }

  try {
    const parsed = parseCommand(spec, rest);
    if (boolFlag(parsed, "help")) {
      io.write(commandHelp(spec, stdoutStyle));
      return 0;
    }
    const handler = HANDLERS[spec.name];
    if (handler === undefined) throw new UsageError(`"${spec.name}" is not implemented.`);
    return await (await handler())(parsed, io, signal);
  } catch (error) {
    return report(error, io, color);
  }
}

/** One place formats a failure, so the exit code and the message cannot disagree. */
function report(error: unknown, io: Io, color: boolean): ExitCode {
  const style = styleFor(color);
  const explained = explain(error);
  const code = style.dim(` [${explained.code}]`);

  io.diagnostic(`${style.red("error")}${code} ${explained.message}\n`);
  if (explained.hint !== undefined) io.diagnostic(`      ${style.dim(explained.hint)}\n`);
  return exitCodeOf(error);
}
