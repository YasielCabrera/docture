/**
 * The file arguments.
 *
 * A shell expands `invoices/*.pdf` before the CLI sees it, which covers most uses.
 * The two it does not cover are a quoted glob and a Windows shell, so a pattern
 * that survives to here is expanded with `fs.glob` rather than handed to the
 * loader as a filename that cannot exist.
 *
 * A pattern that matches nothing is an error. Silently extracting zero documents
 * and exiting 0 is the failure mode that lets a broken nightly job look green.
 */

import { glob } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { UsageError } from "./cli/errors.js";

const URL_LIKE = /^[a-z][a-z0-9+.-]+:\/\//i;
const GLOB_MAGIC = /[*?[\]{}]/;

export interface Input {
  /** What to hand the pipeline: an absolute path, or the URL as given. */
  readonly source: string;
  /** How this document is named in reports and `--out` filenames. */
  readonly label: string;
}

function labelFor(value: string): string {
  try {
    return basename(new URL(value).pathname) || value;
  } catch {
    return basename(value);
  }
}

export async function expandInputs(
  positionals: readonly string[],
  cwd: string,
): Promise<readonly Input[]> {
  if (positionals.length === 0) {
    throw new UsageError("No files given.", "Pass one or more paths, globs, or http(s) URLs.");
  }

  const inputs: Input[] = [];
  const seen = new Set<string>();

  for (const value of positionals) {
    // A URL — http(s) or file: — goes through untouched. `resolveSource` knows how
    // to fetch or read either, and resolving one against the cwd would mangle it.
    if (URL_LIKE.test(value)) {
      if (!seen.has(value)) {
        seen.add(value);
        inputs.push({ source: value, label: labelFor(value) });
      }
      continue;
    }

    if (GLOB_MAGIC.test(value)) {
      const matched: string[] = [];
      for await (const match of glob(value, { cwd })) {
        matched.push(isAbsolute(match) ? match : resolve(cwd, match));
      }
      if (matched.length === 0) {
        throw new UsageError(`No files matched "${value}".`);
      }
      // Stable order: a glob's traversal order is not guaranteed, and a report
      // whose rows move between runs is a report nobody diffs.
      for (const path of matched.sort()) {
        if (seen.has(path)) continue;
        seen.add(path);
        inputs.push({ source: path, label: basename(path) });
      }
      continue;
    }

    const path = isAbsolute(value) ? value : resolve(cwd, value);
    if (seen.has(path)) continue;
    seen.add(path);
    inputs.push({ source: path, label: basename(path) });
  }

  return inputs;
}

/** `invoice.pdf` → `invoice`. The stem an `--out` file or a truth file is named by. */
export function stem(label: string): string {
  const extension = extname(label);
  return extension === "" ? label : label.slice(0, -extension.length);
}
