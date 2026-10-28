import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { UsageError } from "./cli/errors.js";
import type { DoctureConfig } from "./define-config.js";
import { loadExport } from "./load-module.js";
import { parseConfig } from "./config-validation.js";

export interface LoadedConfig {
  readonly config: DoctureConfig;
  /** Absolute path of the file. Relative paths inside the config resolve here. */
  readonly path: string;
}

const FILENAMES = [
  "docture.config.ts",
  "docture.config.mts",
  "docture.config.js",
  "docture.config.mjs",
] as const;

/**
 * Nearest config, walking up from `cwd`.
 *
 * Upward rather than cwd-only so that running the CLI from a subdirectory of a
 * project behaves the way every other tool in that project does.
 */
export async function findConfig(cwd: string): Promise<string | undefined> {
  let directory = resolve(cwd);

  for (;;) {
    for (const name of FILENAMES) {
      const candidate = join(directory, name);
      try {
        const info = await stat(candidate);
        if (info.isFile()) return candidate;
      } catch {
        // Not here; try the next name, then the parent.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export interface ResolveConfigOptions {
  readonly cwd: string;
  /** `--config`. An explicit path that does not exist is an error, not a miss. */
  readonly explicit?: string;
  /** `--no-config`. */
  readonly disabled?: boolean;
}

export async function resolveConfig(
  options: ResolveConfigOptions,
): Promise<LoadedConfig | undefined> {
  if (options.disabled === true) return undefined;

  const path =
    options.explicit === undefined
      ? await findConfig(options.cwd)
      : isAbsolute(options.explicit)
        ? options.explicit
        : resolve(options.cwd, options.explicit);

  if (path === undefined) return undefined;

  const loaded = await loadExport<unknown>(path, {
    kind: "config",
    cwd: options.cwd,
    names: ["config"],
  });

  return { config: parseConfig(loaded.value, loaded.from), path: loaded.from };
}

/** Resolve a path from a config against the config's own directory, not the cwd. */
export function relativeToConfig(loaded: LoadedConfig | undefined, path: string): string {
  if (isAbsolute(path) || loaded === undefined) return path;
  return resolve(dirname(loaded.path), path);
}
