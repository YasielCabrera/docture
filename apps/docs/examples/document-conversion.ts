import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentConverter } from "docture/node";

const converter = new DocumentConverter()
  .loadDocumentLoader(new DocumentLoaderPdfJs());

try {
  const result = await converter.convert("report.pdf", {
    format: "markdown",
    assets: "referenced",
  });

  const outputDirectory = "converted";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "report.md"), result.content);
  for (const asset of result.assets) {
    const path = join(outputDirectory, asset.reference);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, asset.bytes);
  }
} finally {
  await converter.dispose();
}
