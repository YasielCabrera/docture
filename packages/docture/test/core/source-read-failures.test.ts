import { resolveSource } from "../../src/node/index.js";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnsupportedSourceError } from "docture";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "docture-source-read-"));
  await mkdir(join(dir, "folder.pdf"));
  await writeFile(join(dir, "locked.pdf"), "%PDF-1.7");
  await chmod(join(dir, "locked.pdf"), 0o000);
});

afterAll(async () => {
  await chmod(join(dir, "locked.pdf"), 0o600);
  await rm(dir, { recursive: true, force: true });
});

async function failureOf(source: string | URL) {
  const error: unknown = await resolveSource(source).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(UnsupportedSourceError);
  const typed = error as UnsupportedSourceError;
  return { code: typed.code, message: typed.message, cause: (typed.cause as NodeJS.ErrnoException).code };
}

describe("a file that cannot be read", () => {
  it("reports a missing path as a typed source failure that keeps the filesystem cause", async () => {
    const path = join(dir, "absent.pdf");

    expect(await failureOf(path)).toEqual({
      code: "UNSUPPORTED_SOURCE",
      message: `Cannot read ${path}: no such file (ENOENT). Check the path; a relative path resolves from the current directory.`,
      cause: "ENOENT",
    });
  });

  it("reports a missing file URL the same way, naming the local path", async () => {
    const path = join(dir, "absent.pdf");

    expect(await failureOf(pathToFileURL(path))).toEqual({
      code: "UNSUPPORTED_SOURCE",
      message: `Cannot read ${path}: no such file (ENOENT). Check the path; a relative path resolves from the current directory.`,
      cause: "ENOENT",
    });
  });

  it("reports a directory as a typed source failure", async () => {
    const path = join(dir, "folder.pdf");

    expect(await failureOf(path)).toEqual({
      code: "UNSUPPORTED_SOURCE",
      message: `Cannot read ${path}: it is a directory (EISDIR). Pass a file inside it instead.`,
      cause: "EISDIR",
    });
  });

  it.skipIf(process.getuid?.() === 0)("reports a file without read permission as a typed source failure", async () => {
    const path = join(dir, "locked.pdf");

    expect(await failureOf(path)).toEqual({
      code: "UNSUPPORTED_SOURCE",
      message: `Cannot read ${path}: permission denied (EACCES). Grant read access to the file, or run as a user who has it.`,
      cause: "EACCES",
    });
  });
});
