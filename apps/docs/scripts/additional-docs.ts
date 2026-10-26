import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { checkCliInvocations, checkErrorTable, checkExampleCounts, checkOptionsTables } from "./doc-rules.js";

async function filesBelow(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "documents", ".next", ".source"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if ([".md", ".mdx", ".ts", ".tsx"].includes(extname(path))) files.push(path);
  }
  return files;
}

function declaredType(program: ts.Program, name: string): ts.Type {
  const checker = program.getTypeChecker();
  for (const file of program.getSourceFiles()) {
    if (file.fileName.includes("node_modules")) continue;
    for (const node of file.statements) {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === name) {
        return checker.getTypeAtLocation(node);
      }
    }
  }
  throw new Error("Documentation type is missing: " + name);
}

export async function checkAdditionalDocs(root: string, program: ts.Program): Promise<string[]> {
  const checker = program.getTypeChecker();
  const codeType = declaredType(program, "DoctureErrorCode");
  const codes = (codeType.isUnion() ? codeType.types : [codeType]).flatMap((part) =>
    part.isStringLiteral() ? [part.value] : []);
  const manifest = z.object({
    name: z.string(),
    bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  });
  const bins = new Map<string, boolean>();
  const files = [resolve(root, "README.md")];
  for (const entry of await readdir(resolve(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(root, "packages", entry.name);
    const packageFile = resolve(directory, "package.json");
    if (!existsSync(packageFile)) continue;
    const value = manifest.parse(JSON.parse(await readFile(packageFile, "utf8")));
    bins.set(value.name, value.bin !== undefined);
    const readme = resolve(directory, "README.md");
    if (existsSync(readme)) files.push(readme);
  }
  files.push(...await filesBelow(resolve(root, "apps/examples")));
  files.push(...await filesBelow(resolve(root, "apps/docs/components/home")));
  files.push(...await filesBelow(resolve(root, "apps/docs/content/docs")));
  const exampleRoot = resolve(root, "apps/examples");
  const exampleReadme = await readFile(resolve(exampleRoot, "README.md"), "utf8");
  const rows = exampleReadme.split("\n").filter((row) => /^\| \d\d \|/.test(row));
  const needs = rows.map((row) => row.split("|").at(-2)?.trim() ?? "");
  const examplePackage = z.object({ scripts: z.object({ offline: z.string() }) })
    .parse(JSON.parse(await readFile(resolve(exampleRoot, "package.json"), "utf8")));
  const counts = {
    total: (await readdir(exampleRoot)).filter((name) => /^\d\d-/.test(name)).length,
    keyless: needs.filter((need) => need.startsWith("—")).length,
    partial: needs.filter((need) => need.includes("¹")).length,
    offline: [...examplePackage.scripts.offline.matchAll(/\bpnpm\s+[\w-]+/g)].length,
  };
  const failures: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const options = new Map<string, readonly string[]>();
    for (const match of text.matchAll(/(?:<!-- options: (\w+) -->|\{\/\* options: (\w+) \*\/\})/g)) {
      const name = match[1] ?? match[2] ?? "";
      options.set(name, checker.getPropertiesOfType(declaredType(program, name)).map((property) => property.name));
    }
    for (const failure of [
      ...checkErrorTable(text, codes), ...checkCliInvocations(text, bins),
      ...checkOptionsTables(text, options), ...checkExampleCounts(text, counts),
    ]) failures.push(relative(root, file) + ": " + failure);
  }
  return failures;
}
