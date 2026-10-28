import { describe, expect, it } from "vitest";
import { captureIo, run } from "../src/index.js";
import { COMMANDS, EXTRACT } from "../src/cli/specs.js";

interface HelpFlag {
  readonly name: string;
  readonly type: string;
  readonly short?: string;
  readonly choices?: readonly string[];
  readonly defaultLabel?: string;
  readonly description: string;
}

interface HelpDocument {
  readonly version: number;
  readonly command: string;
  readonly ok: boolean;
  readonly results: readonly {
    readonly file: string;
    readonly ok: boolean;
    readonly spec: {
      readonly name: string;
      readonly summary: string;
      readonly positionals: readonly unknown[];
      readonly flags: readonly HelpFlag[];
    };
  }[];
  readonly summary: { readonly environment: readonly { readonly name: string; readonly description: string }[] };
}

async function help(argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = captureIo();
  const code = await run(argv, { io });
  return { code, stdout: io.stdout, stderr: io.stderr };
}

describe("help --json", () => {
  it("lists every command in one versioned help envelope", async () => {
    const result = await help(["help", "--json"]);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.stdout) as HelpDocument;

    expect(document.version).toBe(1);
    expect(document.command).toBe("help");
    expect(document.ok).toBe(true);
    expect(document.results.map((item) => item.file)).toEqual(COMMANDS.map((command) => command.name));
    expect(document.results.map((item) => item.spec.name)).toEqual(expect.arrayContaining(["extract", "convert", "classify", "inspect", "eval"]));
    expect(document.summary.environment.map((entry) => entry.name)).toEqual(expect.arrayContaining(["NO_COLOR", "OPENAI_API_KEY"]));
  });

  it("emits the same single-command document for help extract --json and extract --help --json", async () => {
    const verb = await help(["help", "extract", "--json"]);
    const flag = await help(["extract", "--help", "--json"]);

    expect(verb.code).toBe(0);
    expect(flag.code).toBe(0);
    expect(flag.stderr).toBe("");
    const document = JSON.parse(verb.stdout) as HelpDocument;
    expect(JSON.parse(flag.stdout)).toEqual(document);
    expect(document.command).toBe("help");
    expect(document.results).toHaveLength(1);

    const spec = document.results[0]?.spec;
    expect(spec?.name).toBe("extract");
    expect(spec?.positionals).toEqual([
      { name: "file", description: "Paths, globs, http(s) URLs, or - for stdin", required: true, variadic: true },
    ]);
    const names = spec?.flags.map((entry) => entry.name);
    expect(names).toEqual(EXTRACT.flags.map((entry) => entry.name));
    expect(names).toEqual(expect.arrayContaining(["schema", "model", "help"]));
    expect(spec?.flags.find((entry) => entry.name === "format")).toEqual({
      name: "format",
      type: "string",
      placeholder: "<fmt>",
      choices: ["json", "ndjson", "text"],
      defaultLabel: "json",
      description: "JSON is a versioned envelope; NDJSON streams result items",
    });
    expect(spec?.flags.find((entry) => entry.name === "model")).toMatchObject({ short: "m", type: "string" });
    expect(document.summary.environment.map((entry) => entry.name)).toContain("NO_COLOR");
  });

  it("accepts every choice it documents and rejects any other value with exit 2", async () => {
    const result = await help(["extract", "invoice.pdf", "--format", "yaml"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--format must be one of json, ndjson, text, got "yaml".');
  });

  it("prints command help when --help sits beside an invalid flag value or extra argument", async () => {
    const text = await help(["help", "extract"]);
    for (const argv of [["extract", "--help", "--format", "bogus"], ["mcp", "--help", "stray"]]) {
      const result = await help(argv);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
    }
    expect((await help(["extract", "--help", "--format", "bogus"])).stdout).toBe(text.stdout);
    expect((await help(["extract", "--help", "--json", "--format", "bogus"])).stdout).toBe(
      (await help(["help", "extract", "--json"])).stdout,
    );
  });

  it("emits the full help envelope for --help --json at the top level", async () => {
    const verb = await help(["help", "--json"]);
    for (const flag of ["--help", "-h"]) {
      const result = await help([flag, "--json"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(verb.stdout);
    }
    expect((await help(["--help"])).stdout).toBe((await help(["help"])).stdout);
  });

  it("rejects an unknown help target with exit 2", async () => {
    for (const argv of [["help", "extrct", "--json"], ["help", "extrct"]]) {
      const result = await help(argv);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain('Unknown command "extrct"');
    }
  });

  it("keeps the text help and rejects --json outside the help route", async () => {
    const text = await help(["help", "extract"]);
    expect(text.code).toBe(0);
    expect(text.stdout.startsWith("docture extract")).toBe(true);
    expect(text.stdout).toContain("docture extract <file...> [options]");

    const misuse = await help(["extract", "invoice.pdf", "--json"]);
    expect(misuse.code).toBe(2);
    expect(misuse.stderr).toContain('Unknown option "--json"');
  });
});
