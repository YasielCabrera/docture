import { expect, it, vi } from "vitest";
import { DoctureError, MissingEngineError } from "docture";
import { judge } from "../src/judge/index.js";

vi.mock("../src/judge/engine.js", () => ({
  loadAi: async () => { throw Object.assign(new Error("Cannot find package 'ai' imported from /app/node_modules/@docture/eval/dist/judge/engine.js"), { code: "ERR_MODULE_NOT_FOUND" }); },
}));

it("judge raises MissingEngineError naming the ai peer when it is not installed", async () => {
  const comparator = judge({ model: "provider/model", rubric: "equal" });
  const error = await Promise.resolve(comparator.compare("a", "b", { path: "x", pattern: "x" })).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MissingEngineError);
  expect(error).toBeInstanceOf(DoctureError);
  expect(error).toMatchObject({ code: "MISSING_ENGINE", engine: "ai", range: "^7.0.0", entry: "@docture/eval/judge" });
});

it("judge rethrows any other failure to load ai unchanged", async () => {
  vi.doMock("../src/judge/engine.js", () => ({ loadAi: async () => { throw new SyntaxError("broken install"); } }));
  vi.resetModules();
  const fresh = await import("../src/judge/index.js");
  await expect(Promise.resolve(fresh.judge({ model: "provider/model", rubric: "equal" }).compare("a", "b", { path: "x", pattern: "x" }))).rejects.toThrow(SyntaxError);
});
