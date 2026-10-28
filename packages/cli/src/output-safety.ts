import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, sep } from "node:path";
import { UsageError } from "./cli/errors.js";
import { describeInput, localPathOf, type Input } from "./inputs.js";

/** A local file that `--out` must never replace. */
export interface ProtectedInput {
  readonly label: string;
  readonly path: string;
}

export function localInputs(inputs: readonly Input[]): ProtectedInput[] {
  return inputs.flatMap((input) => {
    const path = localPathOf(input);
    return path === undefined ? [] : [{ label: describeInput(input), path }];
  });
}

type FileIdentity =
  | { kind: "present"; key: string }
  | { kind: "unresolvable" }
  | { kind: "uninspectable" };

async function identity(path: string): Promise<FileIdentity> {
  try {
    const { dev, ino } = await stat(path, { bigint: true });
    return { kind: "present", key: `${dev}:${ino}` };
  } catch (error) {
    if (error instanceof Error && "code" in error && (
      error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "ELOOP"
    )) {
      return { kind: "unresolvable" };
    }
    return { kind: "uninspectable" };
  }
}

/** Refuses an existing output that is an input, or a symlink or hard link to one. */
export async function refuseInputAliases(inputs: readonly ProtectedInput[], outputs: readonly string[]): Promise<void> {
  if (outputs.length === 0) return;
  const sources = await Promise.all(inputs.map(async (input) => ({ ...input, identity: await identity(input.path) })));
  for (const output of outputs) {
    const outputIdentity = await identity(output);
    const source = sources.find((input) => (
      input.path === output || (outputIdentity.kind === "present" && input.identity.kind === "present"
        && input.identity.key === outputIdentity.key)
    ));
    if (source !== undefined) {
      throw new UsageError(
        `--out target "${output}" would overwrite input "${source.label}".`,
        "Choose a different --out, or omit --out.",
      );
    }
    if (outputIdentity.kind === "uninspectable") {
      throw new UsageError(
        `Cannot inspect --out target "${output}" to verify it does not overwrite a local input.`,
        "Choose a new --out destination, or omit --out.",
      );
    }
    if (outputIdentity.kind === "present") {
      const uninspectable = sources.find((input) => input.identity.kind === "uninspectable");
      if (uninspectable !== undefined) {
        throw new UsageError(
          `Cannot verify --out target "${output}" against input "${uninspectable.label}" because the input cannot be inspected.`,
          "Choose a new --out destination, or omit --out.",
        );
      }
    }
  }
}

async function missingLeafTarget(rawPath: string): Promise<string | undefined> {
  try {
    await stat(rawPath);
    return undefined;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return undefined;
  }

  let current = rawPath;
  const visited = new Set<string>();
  while (true) {
    const leaf = basename(current);
    if (current.endsWith(sep) || leaf === "" || leaf === "." || leaf === "..") return undefined;
    try {
      const parent = dirname(current);
      const parentIdentity = await identity(parent);
      if (parentIdentity.kind !== "present") return undefined;
      const key = `${parentIdentity.key}/${leaf}`;
      let entry: Awaited<ReturnType<typeof lstat>>;
      try {
        entry = await lstat(current);
      } catch (error) {
        return error instanceof Error && "code" in error && error.code === "ENOENT" ? key : undefined;
      }
      if (!entry.isSymbolicLink() || visited.has(key)) return undefined;
      visited.add(key);
      const target = await readlink(current);
      // Keep symlink traversal before any .. segments for the next native lookup.
      current = isAbsolute(target) ? target : `${await realpath(parent)}${sep}${target}`;
    } catch {
      return undefined;
    }
  }
}

/** Refuses an output that dangles to the same missing file as an input dangles to. */
export async function refuseMissingLeafAliases(inputs: readonly ProtectedInput[], outputs: readonly string[]): Promise<void> {
  if (outputs.length === 0) return;
  const sources = await Promise.all(inputs.map(async (input) => ({ ...input, key: await missingLeafTarget(input.path) })));
  for (const output of outputs) {
    const key = await missingLeafTarget(output);
    if (key === undefined) continue;
    const source = sources.find((input) => input.key === key);
    if (source !== undefined) {
      throw new UsageError(
        `--out target "${output}" would overwrite input "${source.label}".`,
        "Choose a different --out, or omit --out.",
      );
    }
  }
}
