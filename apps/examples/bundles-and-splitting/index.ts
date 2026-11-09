import { fileURLToPath } from "node:url";
import { defineClassification, defineSplitter, defineStrategy, SplittingStrategy, UNCLASSIFIED, type LoadedPage } from "docture";
import { Extractor, Process } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";

export const ACCOUNT_KINDS = [
  defineClassification({
    name: "checking-account", description: "A checking account statement.",
    schema: z.object({ accountNumber: z.string(), endingBalance: z.number() }),
  }),
  defineClassification({
    name: "credit-line", description: "A revolving credit line statement.",
    schema: z.object({ accountNumber: z.string(), creditLimit: z.number() }),
  }),
] as const;

function heading(page: LoadedPage): string | null {
  if (/Account Reconciliation Form/u.test(page.text)) return UNCLASSIFIED;
  if (/READY RESERVE/u.test(page.text)) return "credit-line";
  if (/TRUE CHECKING/u.test(page.text)) return "checking-account";
  return null;
}

export function accountSplitter() {
  return defineSplitter({
    name: "account-headings",
    requires: ["TEXT_LAYER"],
    async belongsToSameDocument(first, second) {
      const a = heading(first);
      const b = heading(second);
      return {
        belongsToSameDocument: b === null || b === a,
        classificationPage1: a ?? UNCLASSIFIED,
        classificationPage2: b ?? a ?? UNCLASSIFIED,
        confidence: 1,
      };
    },
  });
}

export function bundleProcess() {
  const accountParser = defineStrategy({
    name: "account-summary",
    requires: ["TEXT_LAYER"],
    async extract({ document }) {
      const text = document.text;
      if (/TRUE CHECKING/u.test(text)) {
        const accountNumber = /Account Number:\s*(\d+)/u.exec(text)?.[1];
        const balance = /Ending balance\s+\S+\s+\$([\d,.]+)/u.exec(text)?.[1];
        if (!accountNumber || !balance) throw new Error("Incomplete checking account summary.");
        return { data: { accountNumber, endingBalance: Number(balance.replaceAll(",", "")) } };
      }
      const accountNumber = /READY RESERVE\s+Account Number:\s*(\d+)/u.exec(text)?.[1];
      const limit = /Credit Limit\s+([\d,.]+)/u.exec(text)?.[1];
      if (!accountNumber || !limit) throw new Error("Incomplete credit line summary.");
      return { data: { accountNumber, creditLimit: Number(limit.replaceAll(",", "")) } };
    },
  });
  const extractor = new Extractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [accountParser] });
  return { extractor, process: new Process().loadExtractor(extractor).loadSplitter(accountSplitter()) };
}

export async function runExample() {
  const { extractor, process } = bundleProcess();
  try {
    const documents = await process
      .loadFile(fileURLToPath(new URL("./statement.pdf", import.meta.url)))
      .split(ACCOUNT_KINDS, SplittingStrategy.LAZY)
      .extract({ onUnclassified: "skip" });
    return {
      groups: process.lastSplit?.groups,
      documents: documents.map(({ name, pages, data }) => ({ name, pages, data })),
    };
  } finally {
    await process.dispose();
    await extractor.dispose();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runExample(), null, 2));
}
