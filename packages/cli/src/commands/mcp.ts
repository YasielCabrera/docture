import { MissingEngineError } from "docture";
import type { Parsed } from "../cli/args.js";
import { CliError, type ExitCode } from "../cli/errors.js";
import type { Io } from "../cli/io.js";
import { serveStdio } from "../mcp/server.js";
import { commonOptions } from "../options.js";

export async function mcpCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  try {
    await serveStdio({
      io,
      signal,
      stdin: process.stdin,
      ...(common.configPath === undefined ? {} : { configPath: common.configPath }),
      ...(common.noConfig ? { noConfig: true } : {}),
    });
  } catch (error) {
    if (!(error instanceof MissingEngineError)) throw error;
    throw new CliError(error.message, "Only `docture mcp` needs it; every other command runs without it.", { cause: error });
  }
  return 0;
}
