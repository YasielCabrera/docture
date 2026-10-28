import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir } from "./harness.js";

afterAll(cleanup);

describe("an input file that cannot be read", () => {
  it("reports a missing file as a source failure with a recovery hint in the JSON envelope", async () => {
    const cwd = await tempDir("unreadable-input");
    const result = await cli(["inspect", "absent.pdf", "--no-config", "--format", "json"], { cwd });

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).results).toEqual([
      {
        file: "absent.pdf",
        ok: false,
        error: {
          code: "UNSUPPORTED_SOURCE",
          message: `Cannot read ${join(cwd, "absent.pdf")}: no such file (ENOENT). Check the path; a relative path resolves from the current directory.`,
          hint: "Pass an existing, readable file path, a file:// URL, or an http(s) URL.",
        },
      },
    ]);
  });
});
