import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { DocumentConverter } from "docture";

const converter = new DocumentConverter()
  .loadDocumentLoader(new DocumentLoaderPdfJs());

try {
  const result = await converter.convert("report.pdf", {
    format: "markdown",
    assets: "referenced",
  });

  await saveText(result.content);
  for (const asset of result.assets) {
    await saveAsset(asset.reference, asset.bytes);
  }
} finally {
  await converter.dispose();
}

declare function saveText(content: string): Promise<void>;
declare function saveAsset(name: string, bytes: Uint8Array): Promise<void>;
