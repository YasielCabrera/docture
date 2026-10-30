import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";

import { codeThemes } from "@/lib/code-themes";
import { readExampleSource } from "@/lib/example-source";

export async function SourceExample({ file, title }: { file: string; title?: string }) {
  const code = await readExampleSource(file);
  return (
    <ServerCodeBlock
      code={code.trimEnd()}
      lang={file.endsWith(".tsx") ? "tsx" : "ts"}
      themes={codeThemes}
      codeblock={{ title: title ?? file }}
    />
  );
}
