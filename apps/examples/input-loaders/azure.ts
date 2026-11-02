import { fileURLToPath } from "node:url";
import { DocumentConverter } from "docture/node";
import { DocumentLoaderAzureRead } from "docture/loaders/azure-di";

export async function runExample() {
  const endpoint = process.env["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"];
  const key = process.env["AZURE_DOCUMENT_INTELLIGENCE_KEY"];
  if (!endpoint || !key) throw new Error("Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.");
  await using converter = new DocumentConverter({
    loaders: [new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key } })],
  });
  return await converter.convert(fileURLToPath(new URL("./invoice.pdf", import.meta.url)), { format: "text" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log((await runExample()).content);
