import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { fieldRequiredness, referenceFieldTables } from "../scripts/reference-fields.js";

describe("declaration-derived reference fields", () => {
  it("writes required and inherited optional fields while preserving authored types and meanings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "docture-reference-fields-"));
    try {
      const file = join(directory, "types.ts");
      await writeFile(file, "interface Base { readonly id: string; readonly label?: string }\ninterface Example extends Base { readonly choices: readonly ('a' | 'b')[] }");
      const program = ts.createProgram([file], { strict: true, noLib: true });
      const table = [
        "{/* options: Example */}", "| Field | Type | Meaning |", "| --- | --- | --- |",
        "| `id` | `string` | Stable identity. |", "| `label` | `string` | Human label when known. |",
        "| `choices` | `readonly ('a' \\| 'b')[]` | Allowed choices. |", "",
      ].join("\n");
      const expected = [
        "{/* options: Example */}", "| Field | Type | Required | Meaning |", "| --- | --- | --- | --- |",
        "| `id` | `string` | Yes | Stable identity. |", "| `label` | `string` | No | Human label when known. |",
        "| `choices` | `readonly ('a' \\| 'b')[]` | Yes | Allowed choices. |", "",
      ].join("\n");
      const transform = (text: string) => referenceFieldTables(text, (name) => fieldRequiredness(program, name));
      expect(transform(table)).toBe(expected);
      expect(transform(expected)).toBe(expected);
      expect(() => transform(table.replace("`id`", "`unknown`"))).toThrow("Example has an unknown field");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads optional conversion data from the actual public declarations", () => {
    const program = ts.createProgram([fileURLToPath(new URL("../../../packages/docture/src/index.ts", import.meta.url))], {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, strict: true,
    });
    expect(fieldRequiredness(program, "ConversionResult").get("ocrFallback")).toBe("optional");
    expect(fieldRequiredness(program, "ConversionResult").get("content")).toBe("required");
    expect(fieldRequiredness(program, "ConvertedPage").get("evidence")).toBe("optional");
    expect(fieldRequiredness(program, "TableElement").get("spans")).toBe("optional");
  });
});
