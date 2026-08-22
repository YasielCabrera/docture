import { afterAll, describe, expect, it } from "vitest";
import { UsageError } from "../src/cli/errors.js";
import { loadExport } from "../src/load-module.js";
import { cleanup, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

describe("loadExport", () => {
  it("prefers the default export", async () => {
    const dir = await tempDir("load-default");
    await writeFixture(dir, "m.mjs", `export default { id: "default" };\nexport const schema = { id: "named" };`);

    const loaded = await loadExport<{ id: string }>("./m.mjs", { kind: "schema", cwd: dir, names: ["schema"] });
    expect(loaded.value.id).toBe("default");
    expect(loaded.exportName).toBe("default");
  });

  it("falls back to a named export, then to the only export there is", async () => {
    const dir = await tempDir("load-named");
    await writeFixture(dir, "named.mjs", `export const schema = { id: "named" };`);
    await writeFixture(dir, "lonely.mjs", `export const Invoice = { id: "lonely" };`);

    const named = await loadExport<{ id: string }>("./named.mjs", { kind: "schema", cwd: dir, names: ["schema"] });
    expect(named.value.id).toBe("named");

    const lonely = await loadExport<{ id: string }>("./lonely.mjs", { kind: "schema", cwd: dir, names: ["schema"] });
    expect(lonely.value.id).toBe("lonely");
    expect(lonely.exportName).toBe("Invoice");
  });

  it("refuses to guess between several exports, and says how to choose", async () => {
    const dir = await tempDir("load-ambiguous");
    await writeFixture(dir, "many.mjs", `export const A = 1;\nexport const B = 2;`);

    await expect(
      loadExport("./many.mjs", { kind: "schema", cwd: dir }),
    ).rejects.toThrow(/more than one candidate/);
  });

  it("takes one export by name with a # suffix", async () => {
    const dir = await tempDir("load-hash");
    await writeFixture(dir, "many.mjs", `export const A = { id: "a" };\nexport const B = { id: "b" };`);

    const loaded = await loadExport<{ id: string }>("./many.mjs#B", { kind: "schema", cwd: dir });
    expect(loaded.value.id).toBe("b");
    expect(loaded.exportName).toBe("B");

    await expect(
      loadExport("./many.mjs#C", { kind: "schema", cwd: dir }),
    ).rejects.toThrow(/no export named "C"/);
  });

  it("reads a .json file rather than importing it", async () => {
    const dir = await tempDir("load-json");
    await writeFixture(dir, "s.json", `{ "type": "object" }`);

    const loaded = await loadExport<{ type: string }>("./s.json", { kind: "schema", cwd: dir });
    expect(loaded.value.type).toBe("object");
    expect(loaded.exportName).toBe("(json)");
  });

  it("reports a missing file as a missing file, not as a bad specifier", async () => {
    const dir = await tempDir("load-missing");

    await expect(loadExport("./nope.mjs", { kind: "schema", cwd: dir })).rejects.toThrow(
      /Cannot find the schema/,
    );
    await expect(loadExport("./nope.json", { kind: "schema", cwd: dir })).rejects.toThrow(
      /Cannot find the schema/,
    );
  });

  it("reports malformed JSON with the reason", async () => {
    const dir = await tempDir("load-badjson");
    await writeFixture(dir, "s.json", `{ "type": `);

    await expect(loadExport("./s.json", { kind: "schema", cwd: dir })).rejects.toThrow(
      /is not valid JSON/,
    );
  });

  it("fails a module that exports nothing with an instruction, not a stack trace", async () => {
    const dir = await tempDir("load-empty");
    await writeFixture(dir, "empty.mjs", `const unused = 1;`);

    const error = await loadExport("./empty.mjs", { kind: "schema", cwd: dir }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).hint).toContain("export default");
  });

  it("imports TypeScript, which is the whole point of --schema ./invoice.ts", async () => {
    const dir = await tempDir("load-ts");
    await writeFixture(
      dir,
      "invoice.ts",
      `interface Shape { readonly id: string }
export default { id: "typescript" } satisfies Shape;
`,
    );

    const loaded = await loadExport<{ id: string }>("./invoice.ts", { kind: "schema", cwd: dir });
    expect(loaded.value.id).toBe("typescript");
  });
});
