import { describe, expect, it } from "vitest";
import {
  boolFlag,
  choiceFlag,
  listFlag,
  nearest,
  numberFlag,
  parseCommand,
  stringFlag,
  type CommandSpec,
} from "../src/cli/args.js";
import { UsageError } from "../src/cli/errors.js";
import { COMMANDS, EXTRACT } from "../src/cli/specs.js";

const SPEC: CommandSpec = {
  name: "demo",
  summary: "for the test",
  args: "<file...>",
  flags: [
    { name: "schema", type: "string", short: "s", describe: "" },
    { name: "count", type: "string", describe: "" },
    { name: "only", type: "string", multiple: true, describe: "" },
    { name: "mode", type: "string", describe: "" },
    { name: "verbose", type: "boolean", short: "v", describe: "" },
  ],
};

describe("parseCommand", () => {
  it("separates flags from positionals", () => {
    const parsed = parseCommand(SPEC, ["a.pdf", "-s", "./x.ts", "b.pdf", "--verbose"]);

    expect(parsed.positionals).toEqual(["a.pdf", "b.pdf"]);
    expect(stringFlag(parsed, "schema")).toBe("./x.ts");
    expect(boolFlag(parsed, "verbose")).toBe(true);
    expect(boolFlag(parsed, "quiet")).toBe(false);
  });

  it("collects a repeatable flag, and normalises a single use to a list", () => {
    expect(listFlag(parseCommand(SPEC, ["--only", "a", "--only", "b"]), "only")).toEqual(["a", "b"]);
    expect(listFlag(parseCommand(SPEC, ["--only", "a"]), "only")).toEqual(["a"]);
    expect(listFlag(parseCommand(SPEC, []), "only")).toEqual([]);
  });

  it("turns an unknown flag into a usage error that suggests the real one", () => {
    let thrown: unknown;
    try {
      parseCommand(SPEC, ["--sche"]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UsageError);
    expect((thrown as UsageError).exitCode).toBe(2);
    expect((thrown as UsageError).hint).toContain("--schema");
  });

  it("never lets a parse failure escape as a raw TypeError", () => {
    // A string flag with no value: parseArgs throws, and exit 2 is the contract.
    expect(() => parseCommand(SPEC, ["--schema"])).toThrow(UsageError);
  });
});

describe("nearest", () => {
  const COMMAND_NAMES = ["extract", "classify", "inspect", "eval"];

  it("catches the three typos people actually make", () => {
    expect(nearest("extrct", COMMAND_NAMES)).toBe("extract"); // a dropped letter
    expect(nearest("extraxt", COMMAND_NAMES)).toBe("extract"); // a slipped key
    expect(nearest("extractt", COMMAND_NAMES)).toBe("extract"); // a doubled one
    expect(nearest("--shema", ["schema", "out", "format"])).toBe("schema");
  });

  it("proposes nothing rather than something wrong", () => {
    expect(nearest("wibble", COMMAND_NAMES)).toBeUndefined();
    expect(nearest("e", COMMAND_NAMES)).toBeUndefined();
  });
});

describe("numberFlag", () => {
  const parse = (value: string) => parseCommand(SPEC, ["--count", value]);

  it("returns undefined when the flag is absent", () => {
    expect(numberFlag(parseCommand(SPEC, []), "count")).toBeUndefined();
  });

  it("rejects what is not a number, before any work has started", () => {
    expect(() => numberFlag(parse("abc"), "count")).toThrow(/expects a number/);
    expect(() => numberFlag(parse("Infinity"), "count")).toThrow(/expects a number/);
  });

  it("enforces the range and the integer requirement", () => {
    expect(numberFlag(parse("4"), "count", { min: 1, max: 8 })).toBe(4);
    expect(() => numberFlag(parse("0"), "count", { min: 1 })).toThrow(/at least 1/);
    expect(() => numberFlag(parse("9"), "count", { max: 8 })).toThrow(/at most 8/);
    expect(() => numberFlag(parse("1.5"), "count", { integer: true })).toThrow(/whole number/);
  });
});

describe("choiceFlag", () => {
  it("accepts a listed value and names the alternatives for one that is not", () => {
    const ok = parseCommand(SPEC, ["--mode", "fast"]);
    expect(choiceFlag(ok, "mode", ["fast", "slow"])).toBe("fast");

    const bad = parseCommand(SPEC, ["--mode", "medium"]);
    expect(() => choiceFlag(bad, "mode", ["fast", "slow"])).toThrow(/fast, slow/);
  });
});

describe("the specs themselves", () => {
  it("give every flag a description, since help is generated from them", () => {
    for (const command of COMMANDS) {
      for (const flag of command.flags) {
        expect(flag.describe, `${command.name} --${flag.name}`).not.toBe("");
      }
    }
  });

  it("declare no flag twice, which parseArgs would silently accept", () => {
    for (const command of COMMANDS) {
      const names = command.flags.map((f) => f.name);
      expect(new Set(names).size, `${command.name}`).toBe(names.length);

      const shorts = command.flags.map((f) => f.short).filter((s) => s !== undefined);
      expect(new Set(shorts).size, `${command.name} shorts`).toBe(shorts.length);
    }
  });

  it("carries --help everywhere, so `<command> --help` always works", () => {
    for (const command of COMMANDS) {
      expect(command.flags.some((f) => f.name === "help"), command.name).toBe(true);
    }
    expect(EXTRACT.examples?.length ?? 0).toBeGreaterThan(0);
  });
});
