import { ApiTabs, type Panel } from "./api-tabs";
import { Code } from "./code";

/**
 * Four things you can ask for, each in the form you would actually write.
 *
 * Copied from the guides rather than shortened for the page, because a snippet that
 * does not run is worse than no snippet.
 */
const examples = [
  {
    id: "extract",
    label: "Extract",
    note: "A loader reads. A strategy understands. You pick both.",
    lang: "ts",
    code: `import { Extractor, contract } from "docture";
import { LLM } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const Invoice = contract({
  name: "invoice",
  description: "A commercial invoice with a total and line items.",
  schema: z.object({
    invoiceNumber: z.string(),
    total: z.number(),
    lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
  }),
});

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

const result = await extractor.extract("invoice.pdf", Invoice);

result.data.lineItems[0].amount;  // number, inferred from the contract
result.method;                    // which strategy answered
result.usage.costUsd;`,
  },
  {
    id: "classify",
    label: "Classify",
    note: "The name comes back as a union of the candidates, so a switch over it is exhaustive.",
    lang: "ts",
    code: `import { defineClassification } from "docture";

const invoice = defineClassification({
  name: "invoice",
  description: "A vendor billing a customer for itemised goods.",
  schema: Invoice.schema,
});

const receipt = defineClassification({
  name: "receipt",
  description: "A point-of-sale receipt with a merchant and a total.",
  schema: Receipt.schema,
});

const decided = await extractor
  .loadLlm(new LLM(openai("gpt-5")), { classify: true })
  .classify("unknown.pdf", [invoice, receipt] as const);

decided.name;        // "invoice" | "receipt" | "UNKNOWN"
decided.confidence;  // 0 to 1
decided.signals;     // every classifier's verdict, including abstentions`,
  },
  {
    id: "split",
    label: "Split",
    note: "One scan is routinely several documents. The bundle is read once, however many come out.",
    lang: "ts",
    code: `import { Process, SplittingStrategy } from "docture";
import { TextSplitter } from "docture/llm/split";

const documents = await new Process()
  .loadSplitter(new TextSplitter({ model: openai("gpt-5") }))
  .loadExtractor(extractor)
  .loadFile("batch.pdf")
  .split([invoice, receipt], SplittingStrategy.EAGER)
  .extract();

for (const d of documents) {
  d.pages;                                        // which pages of the bundle
  if (d.name === "invoice") d.data.invoiceNumber; // narrowed
  else                      d.data.merchantName;  // narrowed
}`,
  },
  {
    id: "fall-back",
    label: "Fall back",
    note: "Strategies run in the order you declared. Put a free one in front of the model.",
    lang: "ts",
    code: `import { errorCodeOf } from "docture";

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadStrategy(myRegexParser)             // tried first, free and exact
  .loadLlm(new LLM(openai("gpt-5")));      // tried when it throws

const outcome = await extractor.safeExtract("invoice.pdf", Invoice);

if (!outcome.ok) {
  switch (errorCodeOf(outcome.error)) {    // ten literal codes, no string matching
    case "NO_ELIGIBLE_STRATEGY": break;
    case "CONTRACT_VIOLATION": break;
    case "TIMEOUT": break;
  }
}

// Nothing is silent: every attempt lands in result.attempts with its error.`,
  },
  {
    id: "cli",
    label: "Terminal",
    note: "stdout is the data, so it pipes into jq. stderr is the story.",
    lang: "bash",
    code: `npm install --save-dev @docture/cli @ai-sdk/openai zod@^4
npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5

# ✓ invoice.pdf → llm via pdfjs · 2.1s · 3,412 tokens · $0.0041

npx docture inspect scan.pdf            # no model, no API key
npx docture classify unknown.pdf --classifications ./kinds.ts`,
  },
] as const;

export async function Api() {
  const panels: Panel[] = await Promise.all(
    examples.map(async (example) => ({
      id: example.id,
      label: example.label,
      note: example.note,
      code: await Code({ code: example.code, lang: example.lang }),
    })),
  );

  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <h2 className="reveal max-w-[20ch] text-3xl leading-[1.12] font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
          The whole API is four calls and a terminal.
        </h2>

        <div className="reveal mt-12">
          <ApiTabs panels={panels} />
        </div>
      </div>
    </section>
  );
}
