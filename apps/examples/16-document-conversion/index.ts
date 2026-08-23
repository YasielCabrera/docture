/**
 * Grounded PDF conversion without a schema or model.
 *
 *     pnpm --filter @docture/examples convert
 *
 * Needs: nothing. The PDF is generated deterministically in memory.
 */

import { DocumentConverter } from "docture";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { makeRichDocumentPdf } from "@docture/testing";
import { field, heading, note, step } from "../shared/print.js";
import { isMain, run } from "../shared/run.js";

export async function convertRichFixture() {
  const fixture = await makeRichDocumentPdf();
  const converter = new DocumentConverter()
    .loadDocumentLoader(new DocumentLoaderPdfJs());
  try {
    return await converter.convert(
      {
        bytes: fixture.bytes,
        mimeType: "application/pdf",
        fileName: "rich-document.pdf",
      },
      { format: "markdown", assets: "referenced" },
    );
  } finally {
    await converter.dispose();
  }
}

async function main(): Promise<void> {
  heading("Document conversion");
  step("1. generate a real layout-rich PDF in memory");
  note(
    "The fixture has two pages, typography, two columns, a list, table, link, code, " +
      "and an embedded image. No schema or model is involved.",
  );

  step("2. convert it to grounded Markdown");
  const result = await convertRichFixture();
  field("loader", result.loader);
  field("method", result.method);
  field("pages", result.pages.length);
  field("assets", result.assets.map((asset) => asset.reference).join(", "));
  field("warnings", result.warnings.length);

  console.log("\n" + result.content);
  console.log("\nThe library returned strings and Uint8Array assets. It wrote no files.");
}

if (isMain(import.meta.url)) await run(main);
