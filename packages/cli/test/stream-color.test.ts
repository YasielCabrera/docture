import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { captureIo, processIo, run } from "../src/index.js";
import { cleanup, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);
afterEach(() => vi.unstubAllEnvs());

describe("stream color", () => {
  it("honors NO_COLOR for custom Io implementations on both streams", async () => {
    const cwd = await tempDir("custom-no-color");
    await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Invoice"], ""));
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    let stdout = "";
    let stderr = "";
    const io = {
      cwd, env: { NO_COLOR: "1" }, color: true, stdoutColor: true,
      write(chunk: string) { stdout += chunk; },
      diagnostic(chunk: string) { stderr += chunk; },
    };
    expect(await run(["inspect", "a.pdf", "--verbose"], { io })).toBe(0);
    expect(stdout).toContain("a.pdf");
    expect(stderr).toContain("config");
    expect(stdout).not.toContain("\u001b[");
    expect(stderr).not.toContain("\u001b[");
  });

  it("decides stdout and stderr color from their own terminals", () => {
    const stdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stderr = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    vi.stubEnv("NO_COLOR", undefined);
    try {
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
      const io = processIo();
      expect(io.color).toBe(true);
      expect(Reflect.get(io, "stdoutColor")).toBe(false);
      vi.stubEnv("NO_COLOR", "");
      expect(processIo().color).toBe(false);
      expect(Reflect.get(processIo(), "stdoutColor")).toBe(false);
    } finally {
      if (stdout) Object.defineProperty(process.stdout, "isTTY", stdout);
      else Reflect.deleteProperty(process.stdout, "isTTY");
      if (stderr) Object.defineProperty(process.stderr, "isTTY", stderr);
      else Reflect.deleteProperty(process.stderr, "isTTY");
    }
  });

  it("keeps help, inspect and classify stdout plain with colored diagnostics", async () => {
    const cwd = await tempDir("plain-stdout");
    const config = textLoaderConfig(["Invoice INV-42 with a total of 10"], "{ name: 'fixed', async extract() { return { data: {} }; } }")
      .replace("strategies: [", "classifications: [{ name: 'invoice', description: 'Invoice', schema: {} }], classifiers: [{ name: 'kind', async classify() { return { classifier: 'kind', name: 'invoice', confidence: 1 }; } }], strategies: [");
    await writeFixture(cwd, "docture.config.mjs", config);
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    for (const args of [["--help"], ["inspect", "a.pdf"], ["classify", "a.pdf"]]) {
      const io = captureIo({ cwd, env: {}, color: true, stdoutColor: false });
      expect(await run(args, { io })).toBe(0);
      expect(io.stdout).not.toContain("\u001b[");
    }
  });

  it("honors no-color for both streams", async () => {
    for (const args of [["--help", "--no-color"], ["extract", "--help", "--no-color"]]) {
      const io = captureIo({ color: true, stdoutColor: true });
      expect(await run(args, { io })).toBe(0);
      expect(io.stdout).not.toContain("\u001b[");
      expect(io.stderr).not.toContain("\u001b[");
    }
  });

  it("strips terminal controls from JSON and NDJSON errors", async () => {
    const cwd = await tempDir("clean-json-errors");
    await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Invoice"],
      "{ name: 'broken', async extract() { throw new Error('\\u001b[31mred\\u001b[39m failure'); } }"));
    await writeFixture(cwd, "schema.json", '{"type":"object"}');
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    for (const format of ["json", "ndjson"]) {
      const io = captureIo({ cwd, color: true, stdoutColor: false });
      expect(await run(["extract", "a.pdf", "--schema", "schema.json", "--format", format], { io })).toBe(1);
      const output = JSON.parse(io.stdout);
      const item = format === "json" ? output.results[0] : output;
      expect(item.error.message).toBe("Every extraction strategy failed: broken (red failure).");
      expect(item.error.hint).not.toContain("\u001b");
    }
  });
});
