import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const DOCS = resolve(ROOT, "content/docs");
const WORK = resolve(ROOT, ".fence-check");

export interface Fence {
  readonly file: string;
  readonly line: number;
  readonly lang: "ts" | "tsx";
  readonly checked: boolean;
  readonly code: string;
}

export function fencesOf(file: string, source: string): Fence[] {
  return [...source.matchAll(/^```(tsx?)([^\n]*)\n([\s\S]*?)^```/gm)].map((match) => ({
    file,
    line: source.slice(0, match.index).split("\n").length,
    lang: match[1] as "ts" | "tsx",
    checked: /(?:^|\s)check(?:\s|$)/.test(match[2] ?? ""),
    code: match[3] ?? "",
  }));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : entry.name.endsWith(".mdx") ? [join(directory, entry.name)] : []))).flat();
}

export async function compileFences(fences: readonly Fence[]): Promise<Map<Fence, string[]>> {
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });
  const byPath = new Map<string, Fence>();
  for (const [index, fence] of fences.entries()) {
    const path = join(WORK, `fence-${index}.${fence.lang}`);
    byPath.set(path, fence);
    await writeFile(path, `${fence.code}\nexport {};\n`);
  }
  const config = ts.getParsedCommandLineOfConfigFile(resolve(ROOT, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const program = ts.createProgram([...byPath.keys()], { ...config?.options, noEmit: true, incremental: false, plugins: [] });
  const errors = new Map<Fence, string[]>(fences.map((fence) => [fence, []]));
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const fence = diagnostic.file === undefined ? undefined : byPath.get(resolve(diagnostic.file.fileName));
    if (fence === undefined) continue;
    errors.get(fence)?.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }
  await rm(WORK, { recursive: true, force: true });
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fences = (await Promise.all((await walk(DOCS)).map(async (file) => fencesOf(file, await readFile(file, "utf8"))))).flat();
  const checked = fences.filter((fence) => fence.checked);
  const failures = [...await compileFences(checked)].flatMap(([fence, errors]) =>
    errors.map((error) => `${relative(ROOT, fence.file)}:${fence.line}: ${error}`));
  if (failures.length > 0) {
    console.error(`Checked code blocks failed to compile (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Code blocks compiled: ${checked.length} of ${fences.length} TypeScript blocks are marked check.`);
  }
}
