import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "../../src/core/index.js";
import { fakeStrategy } from "./fakes.js";

describe("public error contract", () => {
  it("reports missing wiring and call order with a typed code", async () => {
    const failures: unknown[] = [];
    for (const action of [
      () => core.createExtractor({ loaders: [] }),
      () => core.createDocumentConverter({ loaders: [] }),
      () => new core.DocumentConverter().loadLlm({ id: "text", extraction: () => fakeStrategy() }),
      () => new core.Extractor().loadLlm({ id: "text", extraction: () => fakeStrategy() }, { vision: true }),
      () => core.pageWindows([1], 1),
    ]) {
      try { action(); } catch (error) { failures.push(error); }
    }
    failures.push(await new core.Process().extract().catch((error: unknown) => error));
    expect(failures).toHaveLength(6);
    expect(failures.map((error) => error instanceof core.DoctureError ? error.code : undefined))
      .toEqual(Array(6).fill("MISSING_COMPONENT"));
  });

  it("serializes code and message with the command error shape", () => {
    const error = new core.TimeoutError("extract:slow", 25);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: "TIMEOUT", message: '"extract:slow" exceeded its 25ms deadline.',
    });
  });

  it("recognizes installed-copy identity and rejects lookalike names or codes", async () => {
    const guard: unknown = Reflect.get(core, "isDoctureError");
    expect(typeof guard).toBe("function");
    if (typeof guard !== "function") return;
    const directory = await mkdtemp(join(tmpdir(), "docture-error-identity-"));
    try {
      const target = join(directory, "errors.ts");
      await copyFile(new URL("../../src/core/pipeline/errors.ts", import.meta.url), target);
      const copy: typeof import("../../src/core/pipeline/errors.js") = await import(pathToFileURL(target).href);
      expect(guard(new copy.TimeoutError("slow", 1))).toBe(true);
      expect(guard(new core.LoadFailedError([]))).toBe(true);
      expect(guard(new Error("ordinary"))).toBe(false);
      expect(guard(Object.assign(new Error("lookalike"), { name: "TimeoutError", code: "TIMEOUT" }))).toBe(false);
      expect(guard({ code: "TIMEOUT", message: "lookalike" })).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
