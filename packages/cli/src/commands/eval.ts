import type { Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import type { Io } from "../cli/io.js";

type Subcommand = (parsed: Parsed, io: Io, signal: AbortSignal) => Promise<ExitCode>;

const SUBCOMMANDS: Readonly<Record<string, () => Promise<Subcommand>>> = {
  "eval run": async () => (await import("../eval/run.js")).runCommand,
  "eval report": async () => (await import("../eval/results.js")).reportCommand,
  "eval compare": async () => (await import("../eval/results.js")).compareCommand,
  "eval gate": async () => (await import("../eval/results.js")).gateCommand,
  "eval runs": async () => (await import("../eval/results.js")).runsCommand,
  "eval validate": async () => (await import("../eval/dataset.js")).validateCommand,
  "eval sample": async () => (await import("../eval/dataset.js")).sampleCommand,
  "eval migrate": async () => (await import("../eval/dataset.js")).migrateCommand,
  "eval draft": async () => (await import("../eval/dataset.js")).draftCommand,
  "eval sign-off": async () => (await import("../eval/dataset.js")).signOffCommand,
};

export async function evalCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const load = SUBCOMMANDS[parsed.spec.name];
  if (load === undefined) throw new UsageError(`"docture ${parsed.spec.name}" is not a command.`, "Run `docture eval --help`.");
  return (await load())(parsed, io, signal);
}
