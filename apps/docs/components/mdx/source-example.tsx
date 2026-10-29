import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";

import { readExampleSource } from "@/lib/example-source";

export async function SourceExample({ file, title }: { file: string; title?: string }) {
  const code = await readExampleSource(file);
  return (
    <ServerCodeBlock
      code={code.trimEnd()}
      lang={file.endsWith(".tsx") ? "tsx" : "ts"}
      codeblock={{ title: title ?? file }}
    />
  );
}
