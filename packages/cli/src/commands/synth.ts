import { nearest, type Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import type { Io } from "../cli/io.js";

type Subcommand = (parsed: Parsed, io: Io, signal: AbortSignal) => Promise<ExitCode>;

const SUBCOMMANDS: Readonly<Record<string, () => Promise<Subcommand>>> = {
  "synth list": async () => (await import("../synth/sample.js")).listCommand,
  "synth gen": async () => (await import("../synth/sample.js")).genCommand,
  "synth render": async () => (await import("../synth/sample.js")).renderCommand,
  "synth corpus": async () => (await import("../synth/corpus.js")).corpusCommand,
  "synth verify": async () => (await import("../synth/corpus.js")).verifyCommand,
};

export async function synthCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const load = SUBCOMMANDS[parsed.spec.name];
  if (load !== undefined) return (await load())(parsed, io, signal);
  const names = Object.keys(SUBCOMMANDS).map((name) => name.slice("synth ".length));
  const given = parsed.positionals[0];
  if (given === undefined) throw new UsageError("Name a subcommand.", `Subcommands: ${names.join(", ")}. Run \`docture synth --help\`.`);
  const near = nearest(given, names);
  throw new UsageError(`Unknown subcommand "synth ${given}".`, near === undefined ? `Subcommands: ${names.join(", ")}.` : `Did you mean \`docture synth ${near}\`?`);
}
