import type { FlexibleSchema } from "docture";
import { listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import type { Io } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { commonOptions, wiringFlags } from "../options.js";
import { resolveSchemaSource } from "../schema.js";
import { createHttpService } from "../service/index.js";

export async function serveCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const config = await resolveConfig({ cwd: io.cwd, ...(common.configPath === undefined ? {} : { explicit: common.configPath }), ...(common.noConfig ? { disabled: true } : {}) });
  const schemas: Record<string, FlexibleSchema> = {};
  for (const selection of listFlag(parsed, "schema")) {
    const separator = selection.indexOf("=");
    const name = separator === -1 ? "default" : selection.slice(0, separator);
    const specifier = separator === -1 ? selection : selection.slice(separator + 1);
    if (!/^[A-Za-z][\w-]{0,63}$/u.test(name) || specifier.length === 0 || Object.hasOwn(schemas, name)) throw new UsageError("--schema expects unique name=module selections, or one module named default.");
    const source = await resolveSchemaSource({ specifier, cwd: io.cwd, command: "serve" });
    schemas[name] = source.schema;
    for (const warning of source.warnings) io.diagnostic(`! ${warning}\n`);
  }
  const host = stringFlag(parsed, "host");
  const service = createHttpService({
    io, schemas, flags: wiringFlags(parsed), ...(config === undefined ? {} : { config }),
    ...(host === undefined ? {} : { host }),
    port: numberFlag(parsed, "port", { min: 0, max: 65535, integer: true }) ?? 8787,
    maxConcurrency: numberFlag(parsed, "concurrency", { min: 1, max: 256, integer: true }) ?? 4,
    maxQueue: numberFlag(parsed, "max-queue", { min: 0, max: 10_000, integer: true }) ?? 16,
    maxBodyBytes: numberFlag(parsed, "max-body-bytes", { min: 1, max: 1024 ** 3, integer: true }) ?? 16 * 1024 * 1024,
    bodyTimeoutMs: numberFlag(parsed, "body-timeout", { min: 1, integer: true }) ?? 30_000,
    shutdownTimeoutMs: numberFlag(parsed, "shutdown-timeout", { min: 1, integer: true }) ?? 30_000,
  });
  const { promise: stopped, resolve: stop } = Promise.withResolvers<void>();
  const requestStop = (): void => stop();
  signal.addEventListener("abort", requestStop, { once: true });
  process.once("SIGTERM", requestStop);
  try {
    signal.throwIfAborted();
    const address = await service.start();
    io.write(`${JSON.stringify({ version: 1, command: "serve", ok: true, address })}\n`);
    await stopped;
    return 0;
  } finally {
    signal.removeEventListener("abort", requestStop);
    process.off("SIGTERM", requestStop);
    await service.close();
  }
}
