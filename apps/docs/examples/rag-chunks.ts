import { DocumentConverter } from "docture/node";
import { chunkDocument } from "docture/chunk";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";

const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderPdfJs());

try {
  const result = await converter.convert("report.pdf", { format: "json" });
  const chunks = chunkDocument(result, {
    budget: { unit: "estimatedTokens", max: 200 },
    headingPath: true,
  });

  for (const chunk of chunks) {
    for (const segment of chunk.provenance) {
      const { x, y, width, height } = segment.box;
      console.log(`${chunk.id} page ${segment.pageNumber} box ${x},${y},${width},${height}`);
    }
  }
} finally {
  await converter.dispose();
}
