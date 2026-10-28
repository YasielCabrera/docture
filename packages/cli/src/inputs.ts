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
import { fileURLToPath } from "node:url";
import type { DocumentSource } from "docture";
import { UsageError } from "./cli/errors.js";
import type { Io } from "./cli/io.js";

const URL_LIKE = /^[a-z][a-z0-9+.-]+:\/\//i;
const GLOB_MAGIC = /[*?[\]{}]/;

/**
 * One file argument, described rather than read. Planning (`--dry-run`, output
 * collisions, truth lookup) works on this; only {@link sourcesOf} touches bytes.
 * `label` names the document in reports and `--out` filenames.
 */
export type Input =
  | { readonly kind: "path"; readonly path: string; readonly label: string }
  | { readonly kind: "url"; readonly url: string; readonly label: string }
  | { readonly kind: "stdin"; readonly label: "stdin" };

/** The input as a user would recognise it in a message. */
export function describeInput(input: Input): string {
  switch (input.kind) {
    case "path":
      return input.path;
    case "url":
      return input.url;
    case "stdin":
      return "stdin";
  }
}

/** The local file an input reads, when it reads one: a path or a `file:` URL. */
export function localPathOf(input: Input): string | undefined {
  if (input.kind === "path") return input.path;
  if (input.kind === "url" && /^file:/i.test(input.url)) {
    try {
      return fileURLToPath(input.url);
    } catch {
      return undefined;
    }
  }
  return undefined;
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
    throw new UsageError("No files given.", "Pass one or more paths, globs, http(s) URLs, or - for stdin.");
  }
  if (positionals.filter((value) => value === "-").length > 1) {
    throw new UsageError("stdin (-) can be read only once.", "Pass - at most once.");
  }

  const inputs: Input[] = [];
  const seen = new Set<string>();

  for (const value of positionals) {
    if (value === "-") {
      inputs.push({ kind: "stdin", label: "stdin" });
      continue;
    }

    // A URL — http(s) or file: — goes through untouched. `resolveSource` knows how
    // to fetch or read either, and resolving one against the cwd would mangle it.
    if (URL_LIKE.test(value)) {
      if (!seen.has(value)) {
        seen.add(value);
        inputs.push({ kind: "url", url: value, label: labelFor(value) });
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
        inputs.push({ kind: "path", path, label: basename(path) });
      }
      continue;
    }

    const path = isAbsolute(value) ? value : resolve(cwd, value);
    if (seen.has(path)) continue;
    seen.add(path);
    inputs.push({ kind: "path", path, label: basename(path) });
  }

  return inputs;
}

/**
 * What the pipeline is handed for each input. The only place stdin is read, so
 * call it after every check that should fail before a document is touched.
 */
export async function sourcesOf(
  inputs: readonly Input[],
  io: Pick<Io, "readStdin">,
  signal?: AbortSignal,
): Promise<DocumentSource[]> {
  const sources: DocumentSource[] = [];
  for (const input of inputs) {
    if (input.kind === "path") sources.push(input.path);
    else if (input.kind === "url") sources.push(input.url);
    else sources.push({ bytes: await io.readStdin(signal), fileName: "stdin" });
  }
  return sources;
}

/** `invoice.pdf` → `invoice`. The stem an `--out` file or a truth file is named by. */
export function stem(label: string): string {
  const extension = extname(label);
  return extension === "" ? label : label.slice(0, -extension.length);
}
