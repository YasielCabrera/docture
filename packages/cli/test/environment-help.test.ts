import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureIo, run } from "../src/index.js";

describe("environment help", () => {
  it("lists every provider and gateway credential in top-level and model help", async () => {
    const shared = new URL("../src/environment.ts", import.meta.url);
    const source = readFileSync(existsSync(shared) ? shared : new URL("../src/model.ts", import.meta.url), "utf8");
    const names = [...new Set(source.match(/\b[A-Z][A-Z_]+(?:KEY|TOKEN)\b/g))];
    expect(names).toContain("OPENAI_API_KEY");
    expect(names).toContain("AI_GATEWAY_API_KEY");
    for (const args of [["--help"], ["extract", "--help"], ["help", "classify"], ["eval", "--help"]]) {
      const io = captureIo();
      expect(await run(args, { io })).toBe(0);
      expect(io.stdout).toContain("ENVIRONMENT");
      expect(io.stdout).toContain("NO_COLOR");
      for (const name of names) expect(io.stdout).toContain(name);
    }
  });
});
