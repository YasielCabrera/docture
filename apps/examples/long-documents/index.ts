import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { silentLogger } from "docture";
import { chunkByBudget, chunkByPage } from "docture/llm/prompt";
import { mergePartials } from "docture/llm/merge";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

const References = z.object({ transactions: z.array(z.object({ date: z.string(), page: z.number() })) });

export async function runExample() {
  const bytes = new Uint8Array(await readFile(new URL("./statement.pdf", import.meta.url)));
  const loader = new DocumentLoaderPdfJs();
  const document = await loader.load({ bytes, mimeType: "application/pdf" }, {
    signal: AbortSignal.timeout(60_000), logger: silentLogger,
  });

  const chunks = chunkByPage(document);
  const partials = chunks.map((chunk) => {
    const table = chunk.text.split("TRANSACTIONS")[1]?.split(/\n(?:CHECKS|DAILY BALANCE SUMMARY)/u)[0] ?? "";
    return {
      transactions: [...table.matchAll(/^(\d{2}\/\d{2}\/\d{4})\s+.+\$/gmu)]
        .map((match) => ({ date: match[1], page: chunk.pages[0] })),
    };
  });
  const merged = References.parse(mergePartials(partials));
  return {
    pageChunks: chunks.map((chunk) => chunk.pages),
    budgetChunks: chunkByBudget(document, 6000).map((chunk) => chunk.pages),
    transactions: merged.transactions,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
