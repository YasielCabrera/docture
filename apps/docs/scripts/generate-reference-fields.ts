import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { fieldRequiredness, referenceFieldTables } from "./reference-fields.js";

const root = resolve(import.meta.dirname, "..");
const program = ts.createProgram([resolve(root, "../../packages/docture/src/index.ts")], {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  strict: true,
});

for (const path of ["content/docs/conversion/reference/layout.mdx", "content/docs/conversion/reference/converter.mdx"]) {
  const file = resolve(root, path);
  const source = await readFile(file, "utf8");
  const generated = referenceFieldTables(source, (name) => fieldRequiredness(program, name));
  if (process.argv.includes("--check")) {
    if (generated !== source) throw new Error(`${path}: field requiredness is stale. Run pnpm --filter @docture/docs exec tsx scripts/generate-reference-fields.ts.`);
  } else if (generated !== source) await writeFile(file, generated);
}
console.log(`Reference field requiredness ${process.argv.includes("--check") ? "verified" : "generated"} from TypeScript declarations.`);
