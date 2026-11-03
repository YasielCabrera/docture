import { fileURLToPath } from "node:url";
import { withOcrFallback } from "docture";
import { DocumentConverter } from "docture/node";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderMuPdf, MuPdfRasterizer } from "docture/loaders/mupdf";

export async function runExample() {
  const loader = withOcrFallback(
    new DocumentLoaderMuPdf(),
    new DocumentLoaderTesseract({ rasterizer: new MuPdfRasterizer(), languages: ["eng"] }),
  );
  await using converter = new DocumentConverter({ loaders: [loader] });
  const result = await converter.convert(fileURLToPath(new URL("./mixed.pdf", import.meta.url)), { format: "text" });
  const ocrPages = result.ocrFallback?.pages.filter((page) => page.supplier === "ocr").map((page) => page.pageNumber);
  return { text: result.content, pages: result.pages.length, ocrPages, warnings: result.warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runExample(), null, 2));
