/**
 * Loading a value out of a file the user wrote.
 *
 * A schema, a list of classifications and a config are all "run this module, take
 * that export", so they share one implementation and one set of error messages.
 *
 * TypeScript works because Node strips types itself from 22.18 on — there is no
 * bundler here and no transpiler dependency. When the running Node cannot do it,
 * that is reported as exactly that, with the three ways out, rather than as
 * `ERR_UNKNOWN_FILE_EXTENSION`.
 */

import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UsageError } from "./cli/errors.js";

export interface LoadExportOptions {
  /** What is being loaded, for the error message: "schema", "config", … */
  readonly kind: string;
  readonly cwd: string;
  /**
   * Export names to try, in order, after `default`. The last resort is a module
   * with exactly one export, which is what makes `export const Invoice = …` work.
   */
  readonly names?: readonly string[];
}

export interface Loaded<T> {
  readonly value: T;
  /** Absolute path that was imported. Printed under --verbose. */
  readonly from: string;
  /** Which export it came from, or "(json)". */
  readonly exportName: string;
}

/** `./schemas.ts#Invoice` — path and the one export that was asked for. */
function splitSpecifier(specifier: string): { path: string; exportName?: string } {
  const hash = specifier.lastIndexOf("#");
  if (hash <= 0) return { path: specifier };
  return { path: specifier.slice(0, hash), exportName: specifier.slice(hash + 1) };
}

function importFailure(kind: string, path: string, error: unknown): UsageError {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String(error);

  if (code === "ERR_MODULE_NOT_FOUND" || code === "ENOENT") {
    return new UsageError(
      `Loading the ${kind} "${path}" failed: ${message}`,
      "Install the missing package or fix the import path in this module.",
    );
  }
  // Node < 22.18 will not strip types; Node of any version refuses to strip inside
  // node_modules. Both surface here, and both have the same three ways out.
  if (
    code === "ERR_UNKNOWN_FILE_EXTENSION" ||
    code === "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"
  ) {
    return new UsageError(
      `This Node (${process.version}) will not import the TypeScript ${kind} "${path}".`,
      "Use Node 22.18 or newer, run with --experimental-strip-types, or point at a " +
        "compiled .js/.mjs file or a .json JSON Schema.",
    );
  }
  if (code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") {
    return new UsageError(
      `The ${kind} "${path}" uses TypeScript syntax Node cannot strip (an enum, a namespace, ` +
        `or a parameter property).`,
      "Rewrite it in erasable syntax, or point at a compiled .js/.mjs file.",
    );
  }
  return new UsageError(`Loading the ${kind} "${path}" failed: ${message}`);
}

/**
 * Import `specifier` and return one export from it.
 *
 * Precedence: an explicit `#name`, then `default`, then each of `options.names`,
 * then — only if the module has exactly one export — that one. A module with
 * several candidate exports and no default is an error naming them, because
 * guessing which schema someone meant is the kind of help nobody wants.
 */
export async function loadExport<T>(
  specifier: string,
  options: LoadExportOptions,
): Promise<Loaded<T>> {
  const { path, exportName } = splitSpecifier(specifier);
  const absolute = isAbsolute(path) ? path : resolve(options.cwd, path);

  // A JSON Schema is a document, not a module. Read it rather than import it, so
  // there is no import-attribute dance and no cache to reason about.
  if (absolute.endsWith(".json")) {
    try {
      return {
        value: JSON.parse(await readFile(absolute, "utf8")) as T,
        from: absolute,
        exportName: "(json)",
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT") throw new UsageError(`Cannot find the ${options.kind} "${absolute}".`);
      throw new UsageError(
        `The ${options.kind} "${absolute}" is not valid JSON: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  // `import()` of a missing file reports ERR_MODULE_NOT_FOUND, which reads as a bad
  // bare specifier. Checking first buys a message that says "file", because that is
  // what went wrong nine times out of ten.
  try {
    await stat(absolute);
  } catch {
    throw new UsageError(`Cannot find the ${options.kind} "${absolute}".`);
  }

  let module: Record<string, unknown>;
  try {
    module = (await import(pathToFileURL(absolute).href)) as Record<string, unknown>;
  } catch (error) {
    throw importFailure(options.kind, absolute, error);
  }

  if (exportName !== undefined) {
    const picked = module[exportName];
    if (picked === undefined) {
      throw new UsageError(
        `"${absolute}" has no export named "${exportName}".`,
        `It exports: ${describeExports(module)}.`,
      );
    }
    return { value: picked as T, from: absolute, exportName };
  }

  for (const name of ["default", ...(options.names ?? [])]) {
    const picked = module[name];
    if (picked !== undefined) return { value: picked as T, from: absolute, exportName: name };
  }

  const exports = Object.keys(module).filter((k) => k !== "__esModule");
  const only = exports[0];
  if (exports.length === 1 && only !== undefined) {
    return { value: module[only] as T, from: absolute, exportName: only };
  }

  throw new UsageError(
    exports.length === 0
      ? `"${absolute}" exports nothing.`
      : `"${absolute}" has no default export, and more than one candidate.`,
    exports.length === 0
      ? `Export the ${options.kind} as \`export default\`.`
      : `Name one: --${options.kind} "${path}#${exports[0]}". It exports: ${exports.join(", ")}.`,
  );
}

function describeExports(module: Record<string, unknown>): string {
  const exports = Object.keys(module).filter((k) => k !== "__esModule");
  return exports.length === 0 ? "nothing" : exports.join(", ");
}
