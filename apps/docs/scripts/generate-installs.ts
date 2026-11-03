import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { supportedInstallCommands } from "./install-specs";

async function pages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? pages(join(directory, entry.name))
    : entry.name.endsWith(".mdx") ? [join(directory, entry.name)] : []))).flat();
}

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const stale: string[] = [];
for (const file of await pages(join(root, "content/docs"))) {
  const source = await readFile(file, "utf8");
  const updated = supportedInstallCommands(source);
  if (updated === source) continue;
  if (check) stale.push(relative(root, file));
  else await writeFile(file, updated);
}
if (stale.length > 0) throw new Error(`Install commands differ from supported peers: ${stale.join(", ")}. Run pnpm --filter @docture/docs generate:installs.`);
console.log(`Supported integration install commands ${check ? "verified" : "generated"}.`);
