import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { COMMANDS } from "../src/cli/specs.js";
import { version } from "../src/version.js";
import { cleanup, cli, tempDir } from "./harness.js";

afterAll(cleanup);

let cwd: string;
const at = async (): Promise<string> => (cwd ??= await tempDir("run"));

describe("the top level", () => {
  it("prints help for no arguments, and exits 0", async () => {
    const run = await cli([], { cwd: await at() });

    expect(run.code).toBe(0);
    for (const command of COMMANDS) expect(run.stdout).toContain(command.name);
    expect(run.stdout).toContain("docture <command>");
  });

  it("prints the package version", async () => {
    const run = await cli(["--version"], { cwd: await at() });

    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toBe(version());
    expect(version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("has help for every command, both ways round", async () => {
    for (const command of COMMANDS) {
      const viaFlag = await cli([command.name, "--help"], { cwd: await at() });
      const viaVerb = await cli(["help", command.name], { cwd: await at() });

      expect(viaFlag.code).toBe(0);
      expect(viaFlag.stdout).toContain(`docture ${command.name}`);
      expect(viaFlag.stdout).toContain("OPTIONS");
      expect(viaVerb.stdout).toBe(viaFlag.stdout);
    }
  });

  it("documents every flag it accepts", async () => {
    for (const command of COMMANDS) {
      const help = await cli([command.name, "--help"], { cwd: await at() });
      for (const flag of command.flags) {
        expect(help.stdout, `${command.name} --${flag.name}`).toContain(`--${flag.name}`);
      }
    }
  });

  it("exits 2 for an unknown command, and suggests the near miss", async () => {
    const run = await cli(["extrct"], { cwd: await at() });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Unknown command "extrct"');
    expect(run.stderr).toContain("docture extract");
    expect(run.stdout).toBe("");
  });

  it("exits 2 when the first argument is an option rather than a command", async () => {
    const run = await cli(["--schema", "./x.ts"], { cwd: await at() });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("must be a command");
  });

  it("keeps errors off stdout, so a pipeline sees no half-written JSON", async () => {
    const run = await cli(["extract", "--no-config"], { cwd: await at() });

    expect(run.code).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("error");
  });

  it("writes a version 1 error envelope to stdout when --format json was asked for", async () => {
    const run = await cli(["extract", "invoice.pdf", "--no-config", "--format", "json"], { cwd: await at() });

    expect(run.code).toBe(2);
    expect(JSON.parse(run.stdout)).toEqual({
      version: 1,
      command: "extract",
      ok: false,
      results: [],
      error: {
        code: "USAGE",
        message: "`docture extract` needs a schema.",
        hint: "Pass --schema ./invoice.ts, or set `schema` in docture.config.ts.",
      },
    });
    expect(run.stderr).toContain("error [USAGE] `docture extract` needs a schema.");
  });

  it("writes the error envelope as one NDJSON line, even when the flags themselves failed to parse", async () => {
    const run = await cli(["convert", "a.pdf", "--out", "o", "--format=ndjson", "--to", "docx"], { cwd: await at() });

    expect(run.code).toBe(2);
    expect(run.stdout).toBe(
      '{"version":1,"command":"convert","ok":false,"results":[],"error":{"code":"USAGE",' +
        '"message":"--to must be one of md, markdown, html, txt, text, json, got \\"docx\\".","hint":"Run `docture convert --help`."}}\n',
    );
  });

  it("leaves stdout empty and writes no file when a wrong extract invocation names --out", async () => {
    const dir = await at();
    const run = await cli(["extract", "invoice.pdf", "--no-config", "--format", "json", "-o", "result.json"], { cwd: dir });

    expect([run.code, run.stdout]).toEqual([2, ""]);
    await expect(access(join(dir, "result.json"))).rejects.toThrow("ENOENT");
  });
});
