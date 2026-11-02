import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineStrategy, imageSize, withRasterizer } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { z } from "zod";

export async function runExample() {
  const loader = withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer());
  const pagePreview = defineStrategy({
    name: "page-preview",
    requires: ["GEOMETRY", "RENDERABLE_PAGES"],
    async extract({ document }) {
      const page = document.pages[0];
      if (!page?.image) throw new Error("The first page cannot be rendered.");
      const image = await page.image({ dpi: 100, format: "png" });
      const output = new URL("./output/", import.meta.url);
      await mkdir(output, { recursive: true });
      await writeFile(new URL("page-1.png", output), image);
      return { data: { page: page.pageNumber, lines: page.lines?.length ?? 0, image: imageSize(image) } };
    },
  });
  await using extractor = new Extractor({ loaders: [loader], strategies: [pagePreview] });
  return await extractor.extractData(fileURLToPath(new URL("./invoice.pdf", import.meta.url)), z.object({
    page: z.number(), lines: z.number().positive(),
    image: z.object({ widthPx: z.number().positive(), heightPx: z.number().positive() }),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
