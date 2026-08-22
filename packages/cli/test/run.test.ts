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
});
