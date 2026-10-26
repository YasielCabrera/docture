import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("imports fixtures and doubles with Vitest unavailable", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const require = createRequire(new URL("../../../../apps/docs/package.json", import.meta.url));
  const script = fileURLToPath(new URL("./fixtures/without-vitest.mjs", import.meta.url));
  const run = spawnSync(process.execPath, ["--import", require.resolve("tsx/esm"), script, root], { encoding: "utf8" });
  expect(run.status, run.stdout + run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual({ text: "literal text", fixture: true, isolated: true });
});
