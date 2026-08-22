/**
 * The logging seam.
 *
 * Deliberately structural and tiny so a host can hand in pino, console, or
 * nothing. Extraction runs on documents that are frequently confidential, so the
 * convention this library holds itself to is: log ids, stage names, timings and
 * error classes — never document text and never extracted values.
 */

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Discards everything. The default, so the library is silent unless asked. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

/** A `console`-backed logger, for a CLI or a quick script. */
export function consoleLogger(bindings: Record<string, unknown> = {}): Logger {
  const emit =
    (level: "debug" | "info" | "warn" | "error") =>
    (msg: string, fields?: Record<string, unknown>): void => {
      const merged = { ...bindings, ...fields };
      const suffix = Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : "";
      console[level](`[docture] ${msg}${suffix}`);
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (extra) => consoleLogger({ ...bindings, ...extra }),
  };
}
