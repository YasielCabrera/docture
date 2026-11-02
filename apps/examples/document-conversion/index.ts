import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DocumentConverter } from "docture/node";
import { chunkDocument } from "docture/chunk";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";

export async function runExample(output = new URL("./output/", import.meta.url)) {
  await using converter = new DocumentConverter({ loaders: [new DocumentLoaderPdfJs()] });
  const result = await converter.convert(
    fileURLToPath(new URL("./statement.pdf", import.meta.url)),
    { format: "markdown", assets: "omit" },
  );
  const chunks = chunkDocument(result, { budget: { unit: "characters", max: 1500 } });
  await mkdir(output, { recursive: true });
  await writeFile(new URL("statement.md", output), result.content);
  await writeFile(new URL("chunks.json", output), JSON.stringify(chunks, null, 2));
  return { pages: result.pages.length, chunks: chunks.length, output: fileURLToPath(output) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
