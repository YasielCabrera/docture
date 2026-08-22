import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";

const EXAMPLES_ROOT = resolve(process.cwd(), "examples");

export async function SourceExample({ file, title }: { file: string; title?: string }) {
  const path = resolve(EXAMPLES_ROOT, file);
  if (path !== EXAMPLES_ROOT && !path.startsWith(`${EXAMPLES_ROOT}${sep}`)) {
    throw new Error(`Example path leaves the examples directory: ${file}`);
  }

  const code = await readFile(path, "utf8");
  return (
    <ServerCodeBlock
      code={code.trimEnd()}
      lang="ts"
      codeblock={{ title: title ?? file }}
    />
  );
}
