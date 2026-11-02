import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DocumentLoaderData } from "docture";
import { DocumentConverter } from "docture/node";
import { DocumentLoaderMammoth } from "docture/loaders/mammoth";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { expandEmail } from "docture/inputs/email";

export async function runExample() {
  await using converter = new DocumentConverter({
    loaders: [new DocumentLoaderMammoth(), new DocumentLoaderData(), new DocumentLoaderPdfJs()],
  });
  const docx = await converter.convert(
    fileURLToPath(new URL("./report.docx", import.meta.url)),
    { format: "text" },
  );
  const email = await expandEmail({
    bytes: await readFile(new URL("./invoice.eml", import.meta.url)),
    mimeType: "message/rfc822",
  });
  const parts = await Promise.all(email.parts.map(async (part) => {
    const result = await converter.convert(part.document, { format: "text" });
    return { text: result.content, partId: part.id, parentId: part.parentId };
  }));
  return { report: docx.content, email: parts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
