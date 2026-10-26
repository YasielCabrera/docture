import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

describe("user module import failures", () => {
  it("names missing dependencies imported by a config", async () => {
    for (const dependency of ["./missing-helper.mjs", "docture-missing-provider"]) {
      const cwd = await tempDir("config-import");
      await writeFixture(cwd, "docture.config.mjs", `import "${dependency}"; export default {};`);
      await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
      const result = await cli(["inspect", "a.pdf"], { cwd });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(dependency.replace("./", ""));
      expect(result.stderr).toContain("Install the missing package or fix the import path");
    }
  });

  it("names missing dependencies imported by a schema", async () => {
    for (const dependency of ["./missing-helper.mjs", "docture-missing-provider"]) {
      const cwd = await tempDir("schema-import");
      await writeFixture(cwd, "schema.mjs", `import "${dependency}"; export default {};`);
      await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
      const result = await cli(["extract", "a.pdf", "--no-config", "--schema", "./schema.mjs"], { cwd });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(dependency.replace("./", ""));
      expect(result.stderr).toContain("Install the missing package or fix the import path");
    }
  });
});
